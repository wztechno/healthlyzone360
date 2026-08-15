<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Models\CartItem;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Services\ZoneResolver;

/**
 * "What would this basket cost, right now, delivered where?" — a query that
 * reserves nothing, charges nothing and writes no row.
 *
 * **The same two engines `OrderPlacementService` runs at placement**, run here
 * for a preview instead: `LineProbe` reprices every line exactly as it would
 * be repriced at checkout, and `ZoneResolver` resolves the delivery fee from
 * the address's service area by the identical branch-beats-organisation rule.
 * Two implementations of either would eventually disagree — a preview quoting
 * one number and a placement charging another is the specific failure this
 * class exists to prevent.
 *
 * **Nothing here is a refusal.** `OrderPlacementService::place()` collects a
 * list of reasons and throws `PlacementRefused` with all of them; a preview
 * has no transaction to abort and no order to refuse, so the same facts —
 * `cart_empty`, `address_missing`, `address_not_deliverable`,
 * `area_not_served`, `zone_suspended`, `currency_mismatch`, plus the
 * line-probe vocabulary — come back as
 * `CheckoutPreviewResult::$warnings` inside an ordinary answer. Deliberately
 * the *same words* placement would refuse with: a customer taught one
 * vocabulary for "we don't deliver there" on the cart screen and a different
 * one at checkout has been taught nothing at all.
 *
 * **Every warning is collected, never short-circuited** — the same reason
 * `OrderPlacementService::repriced()` gives: a basket with three unpriceable
 * lines and no address at all should say so in one answer, not four.
 *
 * **Runs inside `SellerContext::during()`**, for the same reason placement
 * does: a customer is a member of no organisation, and the delivery map and
 * the channel's own catalogue assignments both live in organisation-scoped
 * tables that fail closed with no organisation resolved.
 */
final readonly class CheckoutPreviewService
{
    public function __construct(
        private LineProbe $probe,
        private ZoneResolver $zones,
        private SellerContext $seller,
    ) {}

    /**
     * Deliberately throws nothing of its own: every unresolved fact about the
     * cart or the address becomes a warning instead of an exception.
     *
     * Runs inside the cart's own seller context, for the identical reason
     * `OrderPlacementService::place()` does: the delivery map and the
     * allergen-free item lookup both live in organisation-scoped tables that
     * fail closed for a customer, who is a member of no organisation.
     */
    public function preview(
        Cart $cart,
        ?CustomerAddress $address,
        ?string $deliveryWindowCode = null,
        ?CarbonImmutable $requestedDate = null,
    ): CheckoutPreviewResult {
        return $this->seller->during(
            $cart->organisation_id,
            $cart->branch_id,
            function () use ($cart, $address, $requestedDate): CheckoutPreviewResult {
                /** @var list<CartItem> $lines */
                $lines = $cart->items()->orderBy('created_at')->orderBy('id')->get()->all();

                $warnings = $lines === [] ? ['cart_empty'] : [];

                [$subtotal, $lineWarnings] = $this->pricedSubtotal($cart, $lines, $requestedDate);
                $warnings = [...$warnings, ...$lineWarnings];

                [$fee, $zoneWarnings] = $this->deliveryFee($cart, $address);
                $warnings = [...$warnings, ...$zoneWarnings];

                return new CheckoutPreviewResult(
                    cartId: (string) $cart->getKey(),
                    currencyCode: $cart->currency_code,
                    subtotalMinor: $subtotal,
                    deliveryFeeMinor: $fee,
                    totalMinor: $subtotal + ($fee ?? 0),
                    lineCount: count($lines),
                    // Deduplicated and reindexed: three lines refused for the
                    // same reason should read as one fact, not three repeats
                    // of it.
                    warnings: array_values(array_unique($warnings)),
                );
            },
        );
    }

    /**
     * Reprice every line, exactly as `OrderPlacementService::repriced()` would,
     * and sum what is priceable. A line the probe refuses contributes nothing
     * to the subtotal and its refusal reason to the warnings, instead of
     * aborting the whole preview — the honest answer to "what would this
     * basket cost" when part of it no longer can be bought is "this much, and
     * here is what's wrong with the rest".
     *
     * @param  list<CartItem>  $lines
     * @return array{0: int, 1: list<string>}
     */
    private function pricedSubtotal(Cart $cart, array $lines, ?CarbonImmutable $requestedDate): array
    {
        if ($lines === []) {
            return [0, []];
        }

        $channel = SalesChannel::withoutTenancy()->whereKey($cart->sales_channel_id)->first();

        if (! $channel instanceof SalesChannel) {
            return [0, ['channel_unknown']];
        }

        $buyer = CustomerAccount::query()->whereKey($cart->customer_account_id)->first();

        $subtotal = 0;
        $warnings = [];

        foreach ($lines as $line) {
            $result = $this->probe->probe(
                $channel,
                $line->catalogue_item_id,
                $line->catalogue_item_variant_id,
                $line->quantity,
                $requestedDate ?? $line->delivery_date,
                $cart->currency_code,
                $buyer,
            );

            if (! $result->isOrderable()) {
                foreach ($result->refusals as $refusal) {
                    $warnings[] = (string) ($refusal['reason'] ?? 'line_unpriceable');
                }

                continue;
            }

            // Minor units, rounded exactly once, at the line total — the same
            // arithmetic `OrderPlacementService::repriced()` performs, so a
            // preview and the placement it precedes never disagree on a line
            // neither one refused.
            $subtotal += (int) round($result->price->amountMinor * (float) $line->quantity);
        }

        return [$subtotal, $warnings];
    }

    /**
     * The delivery fee, resolved exactly as `OrderPlacementService::zoneFor()`
     * resolves it — branch claim beats organisation-wide, and a zone with no
     * fee configured is `null`, never `0`.
     *
     * @return array{0: int|null, 1: list<string>}
     */
    private function deliveryFee(Cart $cart, ?CustomerAddress $address): array
    {
        if (! $address instanceof CustomerAddress) {
            return [null, ['address_missing']];
        }

        if ($address->address_type !== CustomerAddressType::Delivery) {
            return [null, ['address_not_deliverable']];
        }

        $explained = $this->zones->explain($address->delivery_area_id, $cart->branch_id);

        if ($explained['zone'] instanceof DeliveryZone && ! $explained['serves']) {
            return [null, ['zone_suspended']];
        }

        $zone = $explained['zone'];

        if (! $zone instanceof DeliveryZone) {
            return [null, ['area_not_served']];
        }

        if ($zone->delivery_fee_minor === null) {
            return [null, []];
        }

        if ($zone->currency_code !== $cart->currency_code) {
            return [null, ['currency_mismatch']];
        }

        return [$zone->delivery_fee_minor, []];
    }
}
