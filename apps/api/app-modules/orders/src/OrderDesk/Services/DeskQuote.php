<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Services\ChannelCurrency;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Services\ZoneResolver;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\SellerContext;

/**
 * What a desk sale would cost, and everything standing in the way of it.
 *
 * ## Refusals are data here, not an error
 *
 * This is the one endpoint on the platform where a refusal is the **answer**
 * rather than a failure. `POST /orders` refuses a placement with a 409 because
 * a customer pressed a button and the button did not do what it said; a quote is
 * not a button, it is a question — *what would happen if I sold this?* — and
 * "the soup was withdrawn an hour ago, everything else comes to eleven dollars"
 * is a complete and useful answer to it.
 *
 * So nothing here throws for a business reason. A withdrawn article, an unpriced
 * one, an address nobody delivers to, a cut-off that passed at three: every one
 * of them arrives in the response body with a `reason` code beside the lines
 * that did price, and the desk screen shows the agent both halves at once. A 422
 * would give them one at a time and lose the total.
 *
 * `quotable` is the single field a screen branches on. Any refusal at all — one
 * line's or the whole order's — makes it false, which is the desk's own rule
 * rather than the placement service's: `composeNow()` refuses a whole placement
 * when *any* reason is collected, so a quote that showed a confident total for
 * a basket the placement endpoint would then reject would be a lie the agent
 * repeated to the customer.
 *
 * **The totals are summed over the refusal-free lines only**, and they are
 * offered because a partial total is what an agent actually needs — "drop the
 * soup and it is eleven dollars" is the next thing they say. They are *not* what
 * would be charged, which is why `quotable` sits beside them.
 *
 * ## The prices are the same prices
 *
 * The probe is `LineProbe`, over the kitchen's `desk` channel, on the requested
 * day, in the channel's own currency. That is the identical call
 * `OrderPlacementService::composedSnapshots()` makes and the identical
 * arithmetic — `round(unit × quantity)` in minor units, so the rounding happens
 * once at the line total and never compounds. Two implementations of "what does
 * this cost" is how a quote and a receipt start disagreeing by a piastre, and
 * the customer is standing there holding both.
 *
 * The desk channel prices the same articles as the web shop where the kitchen
 * has assigned them to both, which is what the backfill migration arranged; a
 * price that differs between the two is a tariff decision somebody made, not an
 * artefact of this class.
 *
 * ## What is deliberately not asked
 *
 * **Eligibility.** A quote for a cold caller whose account was opened thirty
 * seconds ago must not report `account_not_ready`: the desk bypasses that gate
 * at placement (`ComposedPlacement::$placedOnBehalfBy`), so raising it here
 * would refuse a sale that is about to go through perfectly.
 *
 * **The agreement gate.** It is a guaranteed no-op on a `pos` channel — see
 * `OrderPlacementService::agreementReasons()` — and running it would mean
 * quoting a corporate minimum against a counter sale.
 *
 * Everything else runs: the shape rules, the address and zone questions on a
 * delivery, and the branch cut-off on a delivery or a pickup. Those are the
 * three families the agent can do something about.
 */
final readonly class DeskQuote
{
    public function __construct(
        private DeskBasket $basket,
        private LineProbe $probe,
        private ChannelCurrency $currencies,
        private ZoneResolver $zones,
        private OrderSchedulingLookup $scheduling,
        private SellerContext $seller,
    ) {}

    /**
     * Price a desk basket through the kitchen's counter.
     *
     * Run inside `SellerContext::during()` for the reason every placement is:
     * the delivery map is an organisation-scoped table that fails closed, and a
     * desk agent's ambient tenancy is their own kitchen's — which is the same
     * organisation here, so the wrapper is belt and braces rather than a bypass.
     * Stating it once is the alternative to this class quietly depending on the
     * caller having a tenant context at all, which a console command would not.
     *
     * @param  list<array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, quantity: string}>  $lines
     * @return array{
     *     lines: list<array<string, mixed>>,
     *     subtotal_minor: int,
     *     delivery_fee_minor: int|null,
     *     total_minor: int,
     *     currency_code: string,
     *     refusals: list<array<string, mixed>>,
     *     quotable: bool
     * }
     */
    public function for(
        SalesChannel $channel,
        FulfilmentType $fulfilmentType,
        array $lines,
        ?CustomerAccount $account = null,
        ?CustomerAddress $address = null,
        ?string $branchId = null,
        ?CarbonImmutable $requestedDate = null,
    ): array {
        return $this->seller->during(
            (string) $channel->organisation_id,
            $branchId,
            fn (): array => $this->quoteNow($channel, $fulfilmentType, $lines, $account, $address, $branchId, $requestedDate),
        );
    }

    /**
     * @param  list<array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, quantity: string}>  $lines
     * @return array{
     *     lines: list<array<string, mixed>>,
     *     subtotal_minor: int,
     *     delivery_fee_minor: int|null,
     *     total_minor: int,
     *     currency_code: string,
     *     refusals: list<array<string, mixed>>,
     *     quotable: bool
     * }
     */
    private function quoteNow(
        SalesChannel $channel,
        FulfilmentType $fulfilmentType,
        array $lines,
        ?CustomerAccount $account,
        ?CustomerAddress $address,
        ?string $branchId,
        ?CarbonImmutable $requestedDate,
    ): array {
        $now = CarbonImmutable::now();

        // The channel's own tariff currency, resolved exactly as a basket's is
        // — `CartService` asks the same class the same question when it opens a
        // cart, and the desk has no basket to have asked earlier.
        //
        // **Asked about now, deliberately, and not about the requested day.** A
        // cart is denominated when it is opened and its lines are priced on the
        // day they are wanted, so a tariff that changes currency between the two
        // surfaces as a `currency_mismatch` refusal rather than as a silently
        // re-denominated order. The desk placement asks this the same way, and
        // the two agreeing is what makes the quoted total the charged total.
        $currencyCode = $this->currencies->for($channel);

        $refusals = $this->shapeRefusals($fulfilmentType, $account, $address);

        $fee = null;

        if ($fulfilmentType->requiresAddress() && $address instanceof CustomerAddress) {
            // The one half of `addressReasons()` that survives explicit
            // resolution. Ownership is already settled — `ResolvesDeskParty`
            // 404s an address that is not this account's, so `address_not_owned`
            // is unreachable from here — but a billing address is a legal row
            // this endpoint can be handed, and a quote that priced a delivery to
            // one would be refused at placement for a reason it never mentioned.
            if ($address->address_type !== CustomerAddressType::Delivery) {
                $refusals[] = [
                    'reason' => 'address_not_deliverable',
                    'address_type' => $address->address_type->value,
                ];
            }

            [$zone, $zoneRefusals] = $this->zoneFor($branchId, $address);
            $refusals = [...$refusals, ...$zoneRefusals];

            if ($zone instanceof DeliveryZone && $zone->delivery_fee_minor !== null) {
                if ($zone->currency_code === $currencyCode) {
                    $fee = $zone->delivery_fee_minor;
                } else {
                    // The placement service's own refusal, in the placement
                    // service's own shape. A fee in another currency is not a
                    // fee for this order and is never converted.
                    $refusals[] = [
                        'reason' => 'currency_mismatch',
                        'subject' => 'delivery_fee',
                        'expected_currency' => $currencyCode,
                        'offered_currency' => $zone->currency_code,
                    ];
                }
            }
        }

        // Delivery and pickup, never a counter sale — the cut-off is about when
        // the food can be *made*, and a counter sale is handed over now.
        if ($fulfilmentType !== FulfilmentType::Counter) {
            $refusals = [...$refusals, ...$this->scheduleRefusals($branchId, $requestedDate, $now)];
        }

        [$quoted, $lineRefused] = $this->lines($channel, $lines, $currencyCode, $requestedDate, $account);

        $subtotal = 0;

        foreach ($quoted as $line) {
            // Refusal-free lines only. Summing a refused line would put a price
            // on something the kitchen has said it will not sell.
            if ($line['refusals'] === []) {
                $subtotal += $line['line_total_minor'] ?? 0;
            }
        }

        return [
            'lines' => $quoted,
            'subtotal_minor' => $subtotal,
            // Null rather than zero when no fee applies. Zero is a fee somebody
            // decided on — a free-delivery zone — and a pickup has no fee at
            // all; a screen that could not tell them apart would print
            // "Delivery: 0.00" on a counter sale.
            'delivery_fee_minor' => $fee,
            'total_minor' => $subtotal + ($fee ?? 0),
            'currency_code' => $currencyCode,
            'refusals' => $refusals,
            'quotable' => $refusals === [] && ! $lineRefused,
        ];
    }

    /**
     * Every line, priced or explained.
     *
     * The basket is aggregated **first** — `DeskBasket` merges duplicate taps
     * into one line per article — so the quote and the placement price the same
     * shape. A quote that priced three separate coffees while the placement
     * merged them into one line of three would be a total the customer was shown
     * and a total they were charged, differing for a reason nobody could see.
     *
     * @param  list<array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, quantity: string}>  $lines
     * @return array{0: list<array<string, mixed>>, 1: bool}
     */
    private function lines(
        SalesChannel $channel,
        array $lines,
        string $currencyCode,
        ?CarbonImmutable $on,
        ?CustomerAccount $account,
    ): array {
        $quoted = [];
        $anyRefused = false;

        foreach ($this->basket->aggregate($lines) as $line) {
            $result = $this->probe->probe(
                $channel,
                $line->catalogueItemId,
                $line->catalogueItemVariantId,
                $line->quantity,
                $on,
                $currencyCode,
                $account,
            );

            $item = $result->item;
            $price = $result->price;

            $refused = $result->refusals !== [] || ! $item instanceof CatalogueItem || $price === null;

            if ($refused) {
                $anyRefused = true;
            }

            $quoted[] = [
                'catalogue_item_id' => $line->catalogueItemId,
                'catalogue_item_variant_id' => $line->catalogueItemVariantId,
                // The **merged** quantity, which is the number the placement
                // will use and therefore the number the agent has to see.
                'quantity' => $line->quantity,
                'name_en' => $item?->name_en,
                'name_ar' => $item?->name_ar,
                'unit_price_minor' => $price?->amountMinor,
                // Minor units, rounded once at the line total — the identical
                // arithmetic `composedSnapshots()` performs, because a quote
                // that rounded differently would disagree with the receipt by a
                // piastre while the customer was still at the counter.
                'line_total_minor' => $price === null
                    ? null
                    : (int) round($price->amountMinor * (float) $line->quantity),
                // The price's own currency where there is one, and the counter's
                // where there is not — a refused line still has to say what the
                // rest of the basket is denominated in.
                'currency_code' => $price->currencyCode ?? $currencyCode,
                'refusals' => $this->attributed($result->refusals, $line),
            ];
        }

        return [$quoted, $anyRefused];
    }

    /**
     * The probe's refusals with the offending article named on every one.
     *
     * `LineProbe` names the item on most of them and not on all — `variant_
     * unknown` carries only the variant — and a client rendering a flat list
     * beside a basket needs every entry to point at a row.
     *
     * @param  list<array<string, mixed>>  $refusals
     * @return list<array<string, mixed>>
     */
    private function attributed(array $refusals, ComposedLine $line): array
    {
        return array_map(
            static fn (array $refusal): array => $refusal + ['catalogue_item_id' => $line->catalogueItemId],
            $refusals,
        );
    }

    /**
     * The three shape rules, restated for a surface that has no placement to
     * refuse.
     *
     * Identical vocabulary to `OrderPlacementService::shapeReasons()` and
     * deliberately so: an agent who sees `address_not_applicable` on a quote and
     * then again on a placement is reading one rule stated twice, not two rules
     * that happen to agree. The placement service keeps its own copy because a
     * job or a console command never passes through here.
     *
     * @return list<array<string, mixed>>
     */
    private function shapeRefusals(FulfilmentType $type, ?CustomerAccount $account, ?CustomerAddress $address): array
    {
        $refusals = [];

        if ($type->requiresCustomer() && $account === null) {
            $refusals[] = ['reason' => 'customer_required', 'fulfilment_type' => $type->value];
        }

        if ($type->requiresAddress() && $address === null) {
            $refusals[] = ['reason' => 'address_required', 'fulfilment_type' => $type->value];
        }

        if (! $type->requiresAddress() && $address !== null) {
            $refusals[] = ['reason' => 'address_not_applicable', 'fulfilment_type' => $type->value];
        }

        return $refusals;
    }

    /**
     * @return array{0: DeliveryZone|null, 1: list<array<string, mixed>>}
     */
    private function zoneFor(?string $branchId, CustomerAddress $address): array
    {
        $areaId = $address->delivery_area_id;
        $explained = $this->zones->explain($areaId, $branchId);

        if ($explained['serves'] && $explained['zone'] instanceof DeliveryZone) {
            return [$explained['zone'], []];
        }

        if ($explained['zone'] instanceof DeliveryZone) {
            return [null, [[
                'reason' => 'zone_suspended',
                'delivery_area_id' => $areaId,
                'zone_status' => $explained['status'],
            ]]];
        }

        // `served_by_anyone` is deliberately absent here where the placement
        // service carries it. That field answers "would another kitchen deliver
        // to you?", which is a marketplace answer for a shopper; a desk agent
        // is asking whether *this* kitchen goes there, and the port call to find
        // out about everybody else would be a query spent on a sentence nobody
        // at the counter would say out loud.
        return [null, [[
            'reason' => 'area_not_served',
            'delivery_area_id' => $areaId,
        ]]];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function scheduleRefusals(?string $branchId, ?CarbonImmutable $requestedDate, CarbonImmutable $now): array
    {
        if ($branchId === null || ! $requestedDate instanceof CarbonImmutable) {
            return [];
        }

        $schedule = $this->scheduling->explain($branchId, $requestedDate, $now);

        if ($schedule['accepted']) {
            return [];
        }

        return [[
            'reason' => $schedule['reason'] ?? 'cut_off_passed',
            'branch_id' => $branchId,
            'requested_date' => $requestedDate->toDateString(),
            'cut_off_at' => $schedule['cut_off_at'],
        ]];
    }
}
