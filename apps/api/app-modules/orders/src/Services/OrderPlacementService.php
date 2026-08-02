<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Models\CartItem;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Customers\Contracts\AreaServiceLookup;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Services\ZoneResolver;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Turning a basket into an order.
 *
 * The one irreversible act in the customer journey, and the place where every
 * question the platform has been deferring has to be answered at once.
 *
 * ## The prices are decided *here*
 *
 * **Every line is repriced at placement.** The cart's prices — the ones the
 * probe found when each line was added — are advisory and were never stored;
 * these are authoritative and become the snapshot. A tariff can change between
 * a customer filling a basket on Tuesday and paying for it on Friday, and the
 * price that governs is the one standing when they commit. Anything else means
 * either charging a price the kitchen has withdrawn or showing a total that is
 * not what will be taken at the door.
 *
 * The consequence is that a line can be refused at checkout that was
 * acceptable in the basket, and that is correct: the article was retired, the
 * channel stopped offering it, the last confirmed price expired. Those are all
 * things that really happened, and `PlacementRefused` names every one of them
 * at once rather than one per attempt.
 *
 * ## One currency, never converted
 *
 * The order takes the cart's currency. Any line that prices in another — and
 * any delivery zone that charges in another — refuses the whole placement.
 * There is no conversion anywhere in this service, because converting would
 * mean inventing an exchange rate, storing a number nobody quoted, and
 * producing a total that reconciles against nothing.
 *
 * ## What is checked, and in what order
 *
 * 1. The cart is open and has lines.
 * 2. The party may order — `CheckoutEligibility`, which asks the right gate for
 *    the shape of account: the activation evaluator for a consumer, a live
 *    `PlaceOrder` guest session for a guest, provisioning status for a company.
 * 3. The address is this customer's and is a delivery address.
 * 4. Somebody delivers there, and specifically *this kitchen* does —
 *    `ZoneResolver`, which is the single place the branch-beats-organisation
 *    precedence lives. The `AreaServiceLookup` port answers the broader
 *    question, so a refusal can say "nobody delivers to this area yet" rather
 *    than the less useful "we do not".
 * 5. The branch will still take an order for the requested day —
 *    `OrderSchedulingLookup`, the port over the kitchen's cut-offs.
 * 6. Every line is repriced and re-checked.
 *
 * All of it inside one transaction, with the cart marked converted in the same
 * transaction: an order that exists beside a still-open basket is how a
 * customer orders twice.
 *
 * ## Idempotency
 *
 * `place()` takes an optional key and runs the whole placement inside
 * `OrderIdempotency`, which claims the key before the order exists and returns
 * the original order on a replay. The guarantee is here rather than in a
 * middleware so that it also holds for a placement made by a job or a console
 * command (master plan v2 §4.14).
 *
 * ## The seller's context
 *
 * The whole placement runs inside `SellerContext::during()`. A customer is a
 * member of no organisation, and the delivery map and the allergen label both
 * live in organisation-scoped tables that fail closed. Stating once that a
 * checkout is transacted in the seller's context is the alternative to
 * re-deriving both of those rules here with a tenancy bypass.
 */
final readonly class OrderPlacementService
{
    public function __construct(
        private LineProbe $probe,
        private CartService $carts,
        private CheckoutEligibility $eligibility,
        private AreaServiceLookup $areas,
        private ZoneResolver $zones,
        private OrderSchedulingLookup $scheduling,
        private DerivedAllergenService $allergens,
        private OrderNumbers $numbers,
        private OrderIdempotency $idempotency,
        private SellerContext $seller,
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * Place the basket as an order.
     *
     * @param  string|null  $deliveryWindowCode  the slot the customer chose, as the window's own code
     * @param  CarbonImmutable|null  $requestedDate  the day asked for; taken from the lines when they name one
     * @param  string|null  $idempotencyKey  the client's replay key, when it sent one
     *
     * @throws PlacementRefused|ApiException
     */
    public function place(
        Cart $cart,
        CustomerAddress $address,
        ?string $deliveryWindowCode = null,
        ?CarbonImmutable $requestedDate = null,
        ?string $idempotencyKey = null,
    ): PlacementResult {
        $account = $this->accountOf($cart);

        $fingerprint = $this->idempotency->fingerprint([
            'cart_id' => (string) $cart->getKey(),
            'customer_account_id' => (string) $account->getKey(),
            'address_id' => (string) $address->getKey(),
            'delivery_window' => $deliveryWindowCode,
            'requested_date' => $requestedDate?->toDateString(),
        ]);

        $outcome = $this->idempotency->around(
            $idempotencyKey,
            $account->user_id,
            $fingerprint,
            fn (): Order => $this->seller->during(
                $cart->organisation_id,
                $cart->branch_id,
                fn (): Order => $this->placeNow($cart, $account, $address, $deliveryWindowCode, $requestedDate),
            ),
        );

        if ($outcome['replay'] !== null) {
            $replayed = Order::query()->whereKey($outcome['replay']['order_id'] ?? null)->first();

            if ($replayed instanceof Order) {
                return new PlacementResult($replayed, replayed: true);
            }

            // The envelope named an order that is no longer there. Refusing is
            // the only honest answer: silently placing a second one is exactly
            // what the key was sent to prevent.
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This request was already answered, but that order can no longer be read.',
            );
        }

        /** @var Order $order */
        $order = $outcome['order'];

        return new PlacementResult($order);
    }

    /**
     * @throws PlacementRefused|ApiException
     */
    private function placeNow(
        Cart $cart,
        CustomerAccount $account,
        CustomerAddress $address,
        ?string $deliveryWindowCode,
        ?CarbonImmutable $requestedDate,
    ): Order {
        $now = CarbonImmutable::now();
        $reasons = [];

        if (! $cart->isShoppable()) {
            // Nothing else can be usefully said about a basket that is no
            // longer a basket, and repricing a converted one would be work
            // done to produce a refusal that is already certain.
            throw new PlacementRefused([['reason' => 'cart_not_open', 'status' => $cart->status->value]]);
        }

        /** @var list<CartItem> $lines */
        $lines = $cart->items()->orderBy('created_at')->orderBy('id')->get()->all();

        if ($lines === []) {
            throw new PlacementRefused([['reason' => 'cart_empty']]);
        }

        $reasons = [...$reasons, ...$this->eligibility->outstanding($account)];
        $reasons = [...$reasons, ...$this->addressReasons($cart, $address)];

        $effectiveDate = $this->effectiveDate($lines, $requestedDate, $reasons);

        [$zone, $zoneReasons] = $this->zoneFor($cart, $address);
        $reasons = [...$reasons, ...$zoneReasons];

        if ($zone instanceof DeliveryZone && $zone->delivery_fee_minor !== null && $zone->currency_code !== $cart->currency_code) {
            $reasons[] = [
                'reason' => 'currency_mismatch',
                'subject' => 'delivery_fee',
                'expected_currency' => $cart->currency_code,
                'offered_currency' => $zone->currency_code,
            ];
        }

        if ($cart->branch_id !== null && $effectiveDate instanceof CarbonImmutable) {
            $schedule = $this->scheduling->explain($cart->branch_id, $effectiveDate, $now);

            if (! $schedule['accepted']) {
                $reasons[] = [
                    'reason' => $schedule['reason'] ?? 'cut_off_passed',
                    'branch_id' => $cart->branch_id,
                    'requested_date' => $effectiveDate->toDateString(),
                    'cut_off_at' => $schedule['cut_off_at'],
                ];
            }
        }

        [$snapshots, $lineReasons] = $this->repriced($cart, $lines, $effectiveDate);
        $reasons = [...$reasons, ...$lineReasons];

        if ($reasons !== []) {
            throw new PlacementRefused($reasons);
        }

        $subtotal = array_sum(array_map(static fn (array $line): int => $line['line_total_minor'], $snapshots));
        $fee = $zone instanceof DeliveryZone ? $zone->delivery_fee_minor : null;

        $order = DB::transaction(function () use ($cart, $account, $address, $zone, $fee, $subtotal, $snapshots, $deliveryWindowCode, $effectiveDate, $now): Order {
            $order = new Order;
            $order->order_number = $this->numbers->next();
            $order->organisation_id = $cart->organisation_id;
            $order->customer_account_id = (string) $account->getKey();
            $order->sales_channel_id = $cart->sales_channel_id;
            $order->branch_id = $cart->branch_id;
            $order->status = OrderStatus::Placed;
            $order->currency_code = $cart->currency_code;
            $order->subtotal_minor = $subtotal;
            $order->delivery_fee_minor = $fee;
            $order->total_minor = $subtotal + ($fee ?? 0);

            // The address as it stands right now, copied. Editing it later
            // must not change where this order was sent.
            $area = DeliveryArea::query()->whereKey($address->delivery_area_id)->first();

            $order->delivery_label = $address->label;
            $order->delivery_line_one = $address->line_one;
            $order->delivery_line_two = $address->line_two;
            // The gazetteer's `region` — the governorate or district. It is
            // deliberately unpopulated in the platform data (OD-12), so this
            // is usually null; the column exists because a courier manifest
            // has a city line and a snapshot that could not fill it would send
            // somebody back to a table that has since changed.
            $order->delivery_city = $area?->region;
            $order->delivery_area_name_en = $area?->name_en;
            $order->delivery_area_name_ar = $area?->name_ar;
            $order->delivery_area_id = $address->delivery_area_id;
            $order->delivery_zone_id = $zone?->getKey() === null ? null : (string) $zone->getKey();
            $order->delivery_window_code = $deliveryWindowCode;
            $order->requested_delivery_date = $effectiveDate;
            $order->payment_method = PaymentMethod::CashOnDelivery;
            $order->placed_at = $now;
            $order->created_by = $this->context->userId();
            $order->lock_version = 0;
            $order->save();

            foreach ($snapshots as $snapshot) {
                $line = new OrderLine;
                $line->order_id = (string) $order->getKey();
                $line->catalogue_item_id = $snapshot['catalogue_item_id'];
                $line->catalogue_item_variant_id = $snapshot['catalogue_item_variant_id'];
                $line->name_en = $snapshot['name_en'];
                $line->name_ar = $snapshot['name_ar'];
                $line->variant_label = $snapshot['variant_label'];
                $line->quantity = $snapshot['quantity'];
                $line->unit_price_minor = $snapshot['unit_price_minor'];
                $line->line_total_minor = $snapshot['line_total_minor'];
                $line->currency_code = $snapshot['currency_code'];
                $line->allergens = $snapshot['allergens'];
                $line->pack_summary = $snapshot['pack_summary'];
                $line->price_list_id = $snapshot['price_list_id'];
                $line->price_list_item_id = $snapshot['price_list_item_id'];
                $line->save();
            }

            // Same transaction, deliberately. An order beside a still-open
            // basket is how a customer orders the same food twice.
            $this->carts->markConverted($cart, (string) $order->getKey());

            return $order;
        });

        $this->audit->record(
            'order.placed',
            actorUserId: $this->context->userId(),
            subjectType: 'order',
            subjectId: (string) $order->getKey(),
            metadata: [
                'cart_id' => (string) $cart->getKey(),
                'customer_account_id' => (string) $account->getKey(),
                'line_count' => count($snapshots),
                'total_minor' => $order->total_minor,
                'currency' => $order->currency_code,
                'payment_method' => $order->payment_method->value,
            ],
        );

        return $order;
    }

    /**
     * Reprice every line and snapshot what the customer is agreeing to.
     *
     * Collected rather than short-circuited: a basket with three withdrawn
     * articles tells the customer about three.
     *
     * @param  list<CartItem>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function repriced(Cart $cart, array $lines, ?CarbonImmutable $on): array
    {
        $channel = SalesChannel::withoutTenancy()->whereKey($cart->sales_channel_id)->first();

        if (! $channel instanceof SalesChannel) {
            return [[], [['reason' => 'channel_unknown', 'sales_channel_id' => $cart->sales_channel_id]]];
        }

        $snapshots = [];
        $refusals = [];

        foreach ($lines as $line) {
            $result = $this->probe->probe(
                $channel,
                $line->catalogue_item_id,
                $line->catalogue_item_variant_id,
                $line->quantity,
                $on ?? $line->delivery_date,
                $cart->currency_code,
            );

            if (! $result->isOrderable()) {
                foreach ($result->refusals as $refusal) {
                    $refusals[] = $refusal + ['cart_item_id' => (string) $line->getKey()];
                }

                continue;
            }

            $item = $result->item;
            $variant = $result->variant;
            $price = $result->price;

            // Minor units, so the multiplication is integer × decimal and the
            // rounding happens exactly once, at the line total. Rounding the
            // unit price would compound across the order.
            $lineTotal = (int) round($price->amountMinor * (float) $line->quantity);

            $snapshots[] = [
                'catalogue_item_id' => (string) $item->getKey(),
                'catalogue_item_variant_id' => $variant?->getKey() === null ? null : (string) $variant->getKey(),
                'name_en' => $item->name_en,
                'name_ar' => $item->name_ar,
                'variant_label' => $variant === null ? null : ($variant->name_en ?? $variant->code),
                'quantity' => $line->quantity,
                'unit_price_minor' => $price->amountMinor,
                'line_total_minor' => $lineTotal,
                'currency_code' => $price->currencyCode,
                'allergens' => $this->publicAllergens($item),
                'pack_summary' => $variant === null ? null : $this->packSummary((string) $variant->getKey()),
                'price_list_id' => $price->priceListId,
                'price_list_item_id' => $price->priceListItemId,
            ];
        }

        return [$snapshots, $refusals];
    }

    /**
     * The customer-facing allergen label, and nothing else.
     *
     * `DerivedAllergenService` returns the derivation and the source
     * ingredient beside the code and the containment; both are dropped here.
     * A source ingredient names part of a formulation, and an order line is
     * the most likely row on the platform to be handed to a courier or a
     * marketplace partner.
     *
     * @return list<array{allergen_code: string, containment: string}>
     */
    private function publicAllergens(CatalogueItem $item): array
    {
        $derived = $this->allergens->forItem($item);

        return array_map(
            static fn (array $allergen): array => [
                'allergen_code' => $allergen['allergen_code'],
                'containment' => $allergen['containment'],
            ],
            $derived['allergens'],
        );
    }

    /**
     * The pack as the customer bought it. Public detail only — size, unit,
     * pieces, net weight — never a cost or a supplier.
     *
     * @return array<string, mixed>|null
     */
    private function packSummary(string $variantId): ?array
    {
        $pack = CatalogueItemPackVariant::withoutTenancy()->whereKey($variantId)->first();

        if (! $pack instanceof CatalogueItemPackVariant) {
            return null;
        }

        return [
            'pack_quantity' => $pack->pack_quantity,
            'pack_unit_id' => $pack->pack_unit_id,
            'pack_piece_count' => $pack->pack_piece_count,
            'pack_format' => $pack->pack_format?->value,
            'net_weight_grams' => $pack->net_weight_grams,
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function addressReasons(Cart $cart, CustomerAddress $address): array
    {
        if ($address->customer_account_id !== $cart->customer_account_id) {
            // Deliberately the same answer as "no such address": confirming
            // that an identifier belongs to somebody else is a disclosure.
            return [['reason' => 'address_not_owned']];
        }

        if ($address->address_type !== CustomerAddressType::Delivery) {
            return [['reason' => 'address_not_deliverable', 'address_type' => $address->address_type->value]];
        }

        return [];
    }

    /**
     * Which zone serves this address for this kitchen, and why not when none
     * does.
     *
     * `ZoneResolver::explain` distinguishes "we have never delivered there"
     * from "we have paused delivering there", and the `AreaServiceLookup` port
     * adds the third case that neither of those covers: nobody on the platform
     * delivers there yet. Three different sentences for a customer, from three
     * different facts.
     *
     * @return array{0: DeliveryZone|null, 1: list<array<string, mixed>>}
     */
    private function zoneFor(Cart $cart, CustomerAddress $address): array
    {
        $areaId = $address->delivery_area_id;

        $explained = $this->zones->explain($areaId, $cart->branch_id);

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

        return [null, [[
            'reason' => 'area_not_served',
            'delivery_area_id' => $areaId,
            'served_by_anyone' => $this->areas->isServed($areaId),
        ]]];
    }

    /**
     * The single day this order is for.
     *
     * **This phase's orders carry one delivery date.** A basket whose lines
     * ask for two different days is a subscription-shaped order — the same
     * meal on Monday and on Wednesday — and it is refused rather than
     * flattened, because flattening would deliver Wednesday's food on Monday.
     * S1 is where a schedule becomes a thing an order can hold. Until then the
     * refusal is the honest answer, and `cart_items.delivery_date` is already
     * shaped to carry the schedule when it arrives.
     *
     * An explicit `$requestedDate` wins, and a basket that disagrees with it
     * is a contradiction rather than a preference.
     *
     * @param  list<CartItem>  $lines
     * @param  list<array<string, mixed>>  $reasons  appended to in place
     */
    private function effectiveDate(array $lines, ?CarbonImmutable $requested, array &$reasons): ?CarbonImmutable
    {
        $dates = [];

        foreach ($lines as $line) {
            if ($line->delivery_date !== null) {
                $dates[$line->delivery_date->toDateString()] = $line->delivery_date;
            }
        }

        if (count($dates) > 1) {
            $reasons[] = ['reason' => 'mixed_delivery_dates', 'dates' => array_keys($dates)];

            return $requested;
        }

        $fromLines = $dates === [] ? null : reset($dates);

        if ($requested !== null && $fromLines instanceof CarbonImmutable && $requested->toDateString() !== $fromLines->toDateString()) {
            $reasons[] = [
                'reason' => 'mixed_delivery_dates',
                'dates' => [$requested->toDateString(), $fromLines->toDateString()],
            ];
        }

        return $requested ?? ($fromLines instanceof CarbonImmutable ? $fromLines : null);
    }

    /**
     * @throws ApiException
     */
    private function accountOf(Cart $cart): CustomerAccount
    {
        $account = CustomerAccount::query()->whereKey($cart->customer_account_id)->first();

        if (! $account instanceof CustomerAccount) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'The customer account behind this basket could not be read.');
        }

        return $account;
    }
}
