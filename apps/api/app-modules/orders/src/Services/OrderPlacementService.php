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
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Services\ZoneResolver;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Organisations\Services\OrganisationTradingGuard;
use Healthy360\Pricing\Contracts\BuyerAgreementLookup;
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
 *
 * ## Orders the platform composes — S1's additive entry point
 *
 * `placeComposed()` places an order that has no basket behind it. S1's
 * subscription generation was the first caller: a delivery day crosses its
 * cut-off and one real order has to exist for it, placed by a scheduled command
 * with no request, no session and no cart. The Order Desk is the second, and it
 * is what made this entry point grow a shape.
 *
 * It is a second entry point rather than a second service, because everything
 * after "where do the lines come from" is identical and having two of it is how
 * a subscription order eventually stops checking the delivery zone. The
 * eligibility gate, the address-ownership rule, the zone resolution, the branch
 * cut-off, the seller context, the idempotency guarantee and the audit event
 * are all the same code; only `repriced()` has a sibling.
 *
 * **Two things differ, and both are deliberate.**
 *
 * 1. **There is no cart to convert.** `ComposedPlacement` states the seller,
 *    channel, branch and currency a cart used to carry; see that class for why
 *    a transient basket was the wrong answer.
 * 2. **A line may carry a `PriceOverride`.** This is the one exception to
 *    "every line is repriced at placement", and it exists because S1's approved
 *    semantics grandfather a subscription's per-day price for the whole of its
 *    balance (§5). The line is still probed — the article must be published,
 *    the channel must offer it that day, the variant must be active — and only
 *    the *price* half of the probe's answer is replaced. `unpriced` and
 *    `currency_mismatch` stop being refusals for an overridden line, because
 *    the caller has supplied both; everything else still refuses. The
 *    provenance is written to `order_lines.price_source`, so a reconciliation
 *    can read why the number disagrees with the standing tariff.
 *
 * ## The composed gate matrix — what a pickup and a counter sale skip, and why
 *
 * A composed placement now states how the order leaves (`ComposedPlacement::
 * $fulfilmentType`), and three of the checks above only make sense for one of
 * the three ways. `composeNow()` is where that is decided, once, so that no
 * later caller has to remember which gate applies to what:
 *
 * | check | delivery | pickup | counter |
 * |---|---|---|---|
 * | `assertTrading()`, empty lines | yes | yes | yes |
 * | `shapeReasons()` | yes | yes | yes |
 * | `CheckoutEligibility::outstanding()` | self-service only | self-service only | self-service only |
 * | `addressReasons()`, `zoneFor()`, fee currency | yes | — | — |
 * | `scheduleReasons()` | yes | **yes** | — |
 * | `composedSnapshots()` (repricing) | yes | yes | yes |
 * | `agreementReasons()`, agreement snapshot | yes | yes | yes |
 *
 * The two rows worth arguing about are the last two.
 *
 * **A pickup is still cooked to a slot.** The address gates fall away because
 * nothing travels, but the kitchen's cut-off is about when the food can be
 * *made*, not about when it can be carried, so a pickup asked for after the
 * branch stopped taking orders for that day is refused exactly as a delivery is.
 * A counter sale is handed over now and has no requested day to be late for.
 *
 * **The agreement gate runs on all three**, and today it is a guaranteed no-op:
 * it returns immediately unless the buyer is a `b2b` account on a channel with
 * private pricing, and neither composed caller is that — subscription generation
 * places for consumers, the desk places on a `pos` channel. It is here for
 * parity rather than for effect. `placeNow()` has always run it, and the day a
 * composed caller places on a private channel — a corporate standing order is
 * the obvious one — the alternative would be a wholesale order placed without a
 * minimum-order check, discovered in a reconciliation months later.
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
        private BuyerAgreementLookup $agreements,
        private OrganisationTradingGuard $trading,
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

        // Exactly one subject, which is what the table's CHECK now demands: a
        // registered customer keys on their identity, a guest on the account
        // that is the only durable thing about them.
        $outcome = $this->idempotency->around(
            $idempotencyKey,
            $account->user_id,
            $account->user_id === null ? (string) $account->getKey() : null,
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
     * Place an order the platform composed — S1's subscription deliveries, and
     * everything the Order Desk sells.
     *
     * Same seller context and same idempotency guarantee as `place()`; the gates
     * are the same ones, applied per fulfilment type (see the class docblock's
     * matrix). The lines are supplied rather than read from a basket, and any of
     * them may carry a grandfathered price.
     *
     * @param  string|null  $idempotencyKey  the caller's replay key — subscription generation keys on subscription + date
     *
     * @throws PlacementRefused|ApiException
     */
    public function placeComposed(ComposedPlacement $placement, ?string $idempotencyKey = null): PlacementResult
    {
        $account = $placement->account;

        // Every component is null-safe now, and the three new ones are here
        // because they change what was placed. Two desk taps a second apart with
        // the same basket, the same customer and the same key — one a pickup and
        // one a delivery, or one paid at the counter and one by WISH — are two
        // different orders, and a fingerprint that could not tell them apart
        // would answer the second with the first.
        $fingerprint = $this->idempotency->fingerprint([
            'composed' => 'v1',
            'customer_account_id' => $account === null ? null : (string) $account->getKey(),
            'address_id' => $placement->address === null ? null : (string) $placement->address->getKey(),
            'sales_channel_id' => $placement->salesChannelId,
            'delivery_window' => $placement->deliveryWindowCode,
            'requested_date' => $placement->requestedDate?->toDateString(),
            'fulfilment_type' => $placement->fulfilmentType->value,
            'placed_on_behalf_by' => $placement->placedOnBehalfBy,
            'payment_method' => $placement->paymentMethod->value,
            'lines' => (string) json_encode(array_map(
                static fn (ComposedLine $line): array => [
                    $line->catalogueItemId,
                    $line->catalogueItemVariantId,
                    $line->quantity,
                    $line->price?->unitPriceMinor,
                ],
                $placement->lines,
            ), JSON_THROW_ON_ERROR),
        ]);

        [$subjectUserId, $subjectAccountId] = $this->composedSubject($placement);

        $outcome = $this->idempotency->around(
            $idempotencyKey,
            $subjectUserId,
            $subjectAccountId,
            $fingerprint,
            fn (): Order => $this->seller->during(
                $placement->organisationId,
                $placement->branchId,
                fn (): Order => $this->composeNow($placement),
            ),
        );

        if ($outcome['replay'] !== null) {
            $replayed = Order::query()->whereKey($outcome['replay']['order_id'] ?? null)->first();

            if ($replayed instanceof Order) {
                return new PlacementResult($replayed, replayed: true);
            }

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
    private function composeNow(ComposedPlacement $placement): Order
    {
        $now = CarbonImmutable::now();

        // The same PA1 stop as `placeNow()`. A subscription's next delivery is
        // composed by a scheduled job rather than a person, and a suspended
        // kitchen must not have orders quietly generated against it while the
        // platform is deciding what to do with it. A desk sale is the same rule
        // seen from the other side: a withdrawn tenant must not keep selling
        // lunch over the counter either.
        $this->trading->assertTrading($placement->organisationId);

        if ($placement->lines === []) {
            throw new PlacementRefused([['reason' => 'cart_empty']]);
        }

        $account = $placement->account;
        $address = $placement->address;

        $reasons = $this->shapeReasons($placement);

        // **The eligibility bypass, and why it is here rather than inside the
        // evaluator.** A desk order is placed for somebody the kitchen has in
        // front of it: a cold caller whose account was provisioned a minute ago
        // has no verified email, no dietary declaration and a `provisional`
        // status, and every one of those is a real requirement for *self*-
        // service. The member of staff is the verification the checklist was
        // asking for.
        //
        // Teaching `CheckoutEligibility` about staff would weaken it for
        // everybody — one flag on the evaluator and the next caller to pass it
        // is a web request. So the gate is untouched and the *call* is skipped,
        // which means the bypass is visible in one place and applies to exactly
        // the placements that name the member of staff responsible for it.
        if ($placement->placedOnBehalfBy === null && $account !== null) {
            $reasons = [...$reasons, ...$this->eligibility->outstanding($account)];
        }

        $effectiveDate = $placement->requestedDate;
        $zone = null;

        // Delivery only. A pickup and a counter sale have no destination, so
        // "is this address theirs", "do we serve it" and "does the fee price in
        // this order's currency" are three questions about nothing — and
        // `zoneFor()` on a null address is not a refusal, it is a crash.
        if ($placement->fulfilmentType->requiresAddress() && $address !== null) {
            if ($account !== null) {
                $reasons = [...$reasons, ...$this->addressReasons((string) $account->getKey(), $address)];
            }

            [$zone, $zoneReasons] = $this->zoneFor($placement->branchId, $address);
            $reasons = [...$reasons, ...$zoneReasons];

            if ($zone instanceof DeliveryZone && $zone->delivery_fee_minor !== null && $zone->currency_code !== $placement->currencyCode) {
                $reasons[] = [
                    'reason' => 'currency_mismatch',
                    'subject' => 'delivery_fee',
                    'expected_currency' => $placement->currencyCode,
                    'offered_currency' => $zone->currency_code,
                ];
            }
        }

        // Delivery *and* pickup. The cut-off is about when the food can be made,
        // not about when it can be carried, so a collection asked for after the
        // branch closed its book for that day is refused exactly as a delivery
        // is. A counter sale is handed over now and has no day to be late for.
        if ($placement->fulfilmentType !== FulfilmentType::Counter) {
            $reasons = [...$reasons, ...$this->scheduleReasons($placement->branchId, $effectiveDate, $now)];
        }

        $channel = SalesChannel::withoutTenancy()->whereKey($placement->salesChannelId)->first();

        [$snapshots, $lineReasons] = $this->composedSnapshots($placement, $effectiveDate);
        $reasons = [...$reasons, ...$lineReasons];

        // Guarded exactly as `placeNow()` guards it, and for the same reason: a
        // subtotal summed over the lines that survived is not this order's
        // subtotal, so testing it against an agreement minimum would invent a
        // `minimum_order_not_met` on top of the refusals that are already true.
        if ($lineReasons === []) {
            $subtotal = array_sum(array_map(static fn (array $line): int => $line['line_total_minor'], $snapshots));
            $reasons = [...$reasons, ...$this->agreementReasons($account, $channel, $subtotal, $effectiveDate ?? $now)];
        }

        if ($reasons !== []) {
            throw new PlacementRefused($reasons);
        }

        $agreement = $this->activeAgreementSnapshot($account, $channel, $effectiveDate ?? $now);

        $order = $this->persist(
            account: $account,
            address: $address,
            organisationId: $placement->organisationId,
            salesChannelId: $placement->salesChannelId,
            branchId: $placement->branchId,
            currencyCode: $placement->currencyCode,
            snapshots: $snapshots,
            zone: $zone,
            deliveryWindowCode: $placement->deliveryWindowCode,
            effectiveDate: $effectiveDate,
            now: $now,
            fulfilmentType: $placement->fulfilmentType,
            paymentMethod: $placement->paymentMethod,
            placedOnBehalfBy: $placement->placedOnBehalfBy,
            b2bAgreementId: $agreement['agreement_id'] ?? null,
            priceListId: $agreement['price_list_id'] ?? null,
        );

        $this->audit->record(
            'order.placed',
            actorUserId: $this->context->userId(),
            subjectType: 'order',
            subjectId: (string) $order->getKey(),
            metadata: [
                'composed' => true,
                'customer_account_id' => $account === null ? null : (string) $account->getKey(),
                'fulfilment_type' => $placement->fulfilmentType->value,
                'placed_on_behalf_by' => $placement->placedOnBehalfBy,
                'line_count' => count($snapshots),
                'total_minor' => $order->total_minor,
                'currency' => $order->currency_code,
                'payment_method' => $order->payment_method->value,
            ],
        );

        return $order;
    }

    /**
     * Whether the placement's own fields agree with the way it says the order
     * leaves — as refusals, not as exceptions.
     *
     * `FulfilmentType::requiresCustomer()` and `requiresAddress()` are the same
     * two predicates `orders_fulfilment_shape_check` states in SQL, asked here
     * so the answer arrives as a sentence rather than as SQLSTATE 23514 from
     * three layers down. The database keeps the constraint regardless — an
     * importer or a backfill is not going through this method — but a desk agent
     * who picked "counter" for a customer they had already given an address for
     * is owed "an address does not apply to a counter sale", not a 500.
     *
     * Three reasons, and the third is the one that would otherwise go unsaid:
     *
     *  * `customer_required` — delivery and pickup. Somebody has to be rung.
     *  * `address_required` — delivery. Somebody has to be driven to.
     *  * `address_not_applicable` — pickup and counter. Refused rather than
     *    silently dropped, because an address supplied and ignored means the
     *    caller believed something about this order that is not true of it, and
     *    the honest answer is to say so before the food is cooked.
     *
     * Collected beside every other reason rather than thrown, so that a
     * placement wrong in two ways says both.
     *
     * @return list<array<string, mixed>>
     */
    private function shapeReasons(ComposedPlacement $placement): array
    {
        $type = $placement->fulfilmentType;
        $reasons = [];

        if ($type->requiresCustomer() && $placement->account === null) {
            $reasons[] = ['reason' => 'customer_required', 'fulfilment_type' => $type->value];
        }

        if ($type->requiresAddress() && $placement->address === null) {
            $reasons[] = ['reason' => 'address_required', 'fulfilment_type' => $type->value];
        }

        if (! $type->requiresAddress() && $placement->address !== null) {
            $reasons[] = ['reason' => 'address_not_applicable', 'fulfilment_type' => $type->value];
        }

        return $reasons;
    }

    /**
     * Who holds the idempotency key for a composed placement.
     *
     * `idempotency_keys_subject_check` is `num_nonnulls(user_id,
     * customer_account_id) = 1` — exactly one subject, never both — so this is a
     * choice and not a pair, and the choice moved when the desk arrived.
     *
     * **A staff placement keys on the member of staff.** The customer may be an
     * account provisioned during the call, or on a counter sale may not exist at
     * all, and neither is a durable subject for a replay guard. The agent is:
     * they are who double-taps the button, they are who the retry comes from,
     * and their user id is already on the placement as `placedOnBehalfBy`.
     * `customerAccountId` is null on that arm because the CHECK forbids the
     * pair, not because the customer is unknown.
     *
     * **Everything else is unchanged** — a registered customer keys on their own
     * identity, a guest on the account that is the only durable thing about
     * them, exactly as `place()` does.
     *
     * Both null is reachable and deliberate: a counter sale with no customer and
     * no staff user is a legal composed shape, and `OrderIdempotency` answers
     * that by declining to protect the placement rather than by inventing a
     * subject. Nothing on the platform composes one today — the desk always
     * names its agent — and a placement with no subject at all has nobody whose
     * retry the key would be recognising.
     *
     * @return array{0: string|null, 1: string|null}
     */
    private function composedSubject(ComposedPlacement $placement): array
    {
        if ($placement->placedOnBehalfBy !== null) {
            return [$placement->placedOnBehalfBy, null];
        }

        $account = $placement->account;

        if (! $account instanceof CustomerAccount) {
            return [null, null];
        }

        return [
            $account->user_id,
            $account->user_id === null ? (string) $account->getKey() : null,
        ];
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

        // PA1. The seller's standing is checked before anything is accumulated,
        // and it throws its own code rather than joining `reasons`. Every entry
        // in that list describes something the shopper can fix — a closed
        // branch, a passed cut-off, a price that moved — and a client that
        // renders them together would file "this kitchen has been suspended"
        // under "try again with a different slot". A withdrawn tenant is not a
        // basket problem.
        $this->trading->assertTrading($cart->organisation_id);

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
        $reasons = [...$reasons, ...$this->addressReasons($cart->customer_account_id, $address)];

        $effectiveDate = $this->effectiveDate($lines, $requestedDate, $reasons);

        [$zone, $zoneReasons] = $this->zoneFor($cart->branch_id, $address);
        $reasons = [...$reasons, ...$zoneReasons];

        if ($zone instanceof DeliveryZone && $zone->delivery_fee_minor !== null && $zone->currency_code !== $cart->currency_code) {
            $reasons[] = [
                'reason' => 'currency_mismatch',
                'subject' => 'delivery_fee',
                'expected_currency' => $cart->currency_code,
                'offered_currency' => $zone->currency_code,
            ];
        }

        $reasons = [...$reasons, ...$this->scheduleReasons($cart->branch_id, $effectiveDate, $now)];

        $channel = SalesChannel::withoutTenancy()->whereKey($cart->sales_channel_id)->first();

        [$snapshots, $lineReasons] = $this->repriced($cart, $lines, $effectiveDate, $account);
        $reasons = [...$reasons, ...$lineReasons];

        if ($lineReasons === []) {
            $subtotal = array_sum(array_map(static fn (array $line): int => $line['line_total_minor'], $snapshots));
            $reasons = [...$reasons, ...$this->agreementReasons($account, $channel, $subtotal, $effectiveDate ?? $now)];
        }

        if ($reasons !== []) {
            throw new PlacementRefused($reasons);
        }

        $agreement = $this->activeAgreementSnapshot($account, $channel, $effectiveDate ?? $now);

        $order = $this->persist(
            account: $account,
            address: $address,
            organisationId: $cart->organisation_id,
            salesChannelId: $cart->sales_channel_id,
            branchId: $cart->branch_id,
            currencyCode: $cart->currency_code,
            snapshots: $snapshots,
            zone: $zone,
            deliveryWindowCode: $deliveryWindowCode,
            effectiveDate: $effectiveDate,
            now: $now,
            // Both stated rather than defaulted, which is the restructuring the
            // Order Desk forced: `persist()` used to hardcode cash on delivery,
            // and a shared writer that decides a commercial fact for its callers
            // is a writer the second caller has to work around. A cart checkout
            // is a courier delivery paid at the door — that has not changed, and
            // now it is said here instead of being assumed there.
            fulfilmentType: FulfilmentType::Delivery,
            paymentMethod: PaymentMethod::CashOnDelivery,
            b2bAgreementId: $agreement['agreement_id'] ?? null,
            priceListId: $agreement['price_list_id'] ?? null,
            // Same transaction, deliberately. An order beside a still-open
            // basket is how a customer orders the same food twice.
            within: fn (Order $order): mixed => $this->carts->markConverted($cart, (string) $order->getKey()),
        );

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
     * Write the order and its lines, in one transaction.
     *
     * Extracted so a basket placement and a composed one cannot drift: the
     * address snapshot, the zone fee, the payment method and the line copy are
     * the same act whoever asked for it, and two copies of this would be two
     * copies of the §4.8 denylist decision about what an order line may carry.
     *
     * **Nothing commercial is decided here any more.** `payment_method` was
     * hardcoded to cash on delivery in this method for the whole of C1, which
     * was true of every order the platform could then take and stopped being
     * true the moment somebody could pay at a counter. Both callers now state
     * the fulfilment type and the payment method, so the one place that knows
     * *how* the order was sold is the one that took it, and this method's job is
     * back to being the shape of the row.
     *
     * **The address snapshot is conditional.** A pickup and a counter sale have
     * no destination, and `orders_fulfilment_shape_check` refuses either of them
     * carrying a `delivery_line_one`. When `$address` is null every `delivery_*`
     * column is simply never written and stays null — including the fee, which
     * keeps `orders_total_check` (`total = subtotal + COALESCE(fee, 0)`)
     * satisfied without a special case. What is *still* written on that branch
     * is `delivery_window_code` and `requested_delivery_date`: a pickup has a
     * promised slot, and the promise is not about travel.
     *
     * **And when there is an address, the whole of it is copied now.** The
     * building, the floor, the apartment, the directions and the contact point
     * have been on `customer_addresses` since it was created and never reached
     * the order; the fulfilment migration added the columns and this is the
     * method that fills them. Both paths flow through here, so a cart checkout
     * gains the richer snapshot too — which is the point. An order delivered to
     * "Rue Gouraud 12" with the *fourth floor, ring twice* part left behind in a
     * table the customer may edit tomorrow is a snapshot that failed at the one
     * job a snapshot has.
     *
     * `$within` runs inside the same transaction after the order exists. The
     * basket path uses it to mark the cart converted; the composed path passes
     * nothing, because there is no basket to convert.
     *
     * @param  CustomerAccount|null  $account  null only on a counter sale for somebody the desk did not name
     * @param  CustomerAddress|null  $address  null for pickup and counter; the whole snapshot block turns on it
     * @param  list<array<string, mixed>>  $snapshots
     * @param  (callable(Order): mixed)|null  $within
     */
    private function persist(
        ?CustomerAccount $account,
        ?CustomerAddress $address,
        string $organisationId,
        string $salesChannelId,
        ?string $branchId,
        string $currencyCode,
        array $snapshots,
        ?DeliveryZone $zone,
        ?string $deliveryWindowCode,
        ?CarbonImmutable $effectiveDate,
        CarbonImmutable $now,
        FulfilmentType $fulfilmentType,
        PaymentMethod $paymentMethod,
        ?string $placedOnBehalfBy = null,
        ?callable $within = null,
        ?string $b2bAgreementId = null,
        ?string $priceListId = null,
    ): Order {
        $subtotal = array_sum(array_map(static fn (array $line): int => $line['line_total_minor'], $snapshots));
        $fee = $zone instanceof DeliveryZone ? $zone->delivery_fee_minor : null;

        return DB::transaction(function () use (
            $account, $address, $organisationId, $salesChannelId, $branchId, $currencyCode,
            $snapshots, $zone, $fee, $subtotal, $deliveryWindowCode, $effectiveDate, $now, $within,
            $b2bAgreementId, $priceListId, $fulfilmentType, $paymentMethod, $placedOnBehalfBy,
        ): Order {
            $order = new Order;
            $order->order_number = $this->numbers->next();
            $order->organisation_id = $organisationId;
            $order->customer_account_id = $account === null ? null : (string) $account->getKey();
            $order->sales_channel_id = $salesChannelId;
            $order->branch_id = $branchId;
            $order->status = OrderStatus::Placed;
            $order->currency_code = $currencyCode;
            $order->subtotal_minor = $subtotal;
            $order->delivery_fee_minor = $fee;
            $order->total_minor = $subtotal + ($fee ?? 0);
            $order->fulfilment_type = $fulfilmentType;

            if ($address !== null) {
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
                // The half of the address that never used to travel. Copied
                // rather than joined for the reason the rest of the block is:
                // the row it came from may be edited, moved or deleted, and the
                // delivery that already happened may not be rewritten by any of
                // that. The contact point is a reference and not a copied
                // number — which number the courier was *given* is the durable
                // fact, and the verification state travels with the row.
                $order->delivery_building = $address->building;
                $order->delivery_floor = $address->floor;
                $order->delivery_apartment = $address->apartment;
                $order->delivery_directions = $address->directions;
                $order->delivery_contact_point_id = $address->contact_point_id;
            }

            // Outside the address branch on purpose. "Be here at six" is a
            // promise whether or not the food travels, so a pickup keeps its
            // window and its day while carrying no destination at all.
            $order->delivery_window_code = $deliveryWindowCode;
            $order->requested_delivery_date = $effectiveDate;
            $order->payment_method = $paymentMethod;
            $order->placed_on_behalf_by = $placedOnBehalfBy;
            $order->b2b_agreement_id = $b2bAgreementId;
            $order->price_list_id = $priceListId;
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
                // NULL for every line the resolver priced — which is every
                // line except a subscription's grandfathered one.
                $line->price_source = $snapshot['price_source'] ?? null;
                $line->save();
            }

            if ($within !== null) {
                $within($order);
            }

            return $order;
        });
    }

    /**
     * Whether the branch will still take an order for that day, as refusals.
     *
     * Shared by both entry points so there is one definition of "too late".
     *
     * @return list<array<string, mixed>>
     */
    private function scheduleReasons(?string $branchId, ?CarbonImmutable $effectiveDate, CarbonImmutable $now): array
    {
        if ($branchId === null || ! $effectiveDate instanceof CarbonImmutable) {
            return [];
        }

        $schedule = $this->scheduling->explain($branchId, $effectiveDate, $now);

        if ($schedule['accepted']) {
            return [];
        }

        return [[
            'reason' => $schedule['reason'] ?? 'cut_off_passed',
            'branch_id' => $branchId,
            'requested_date' => $effectiveDate->toDateString(),
            'cut_off_at' => $schedule['cut_off_at'],
        ]];
    }

    /**
     * Probe and snapshot the lines of a composed placement.
     *
     * The sibling of `repriced()`, and it runs the *same* probe: a composed
     * order is refused for a withdrawn article, an unoffered one or an inactive
     * variant exactly as a basket is. The one difference is what happens to the
     * price half of the answer — see `PriceOverride`. Two refusals become
     * inapplicable when an override is supplied, `unpriced` and
     * `currency_mismatch`, because the caller has supplied both halves of the
     * thing that was missing; every other refusal stands, including a
     * `currency_mismatch` in the override itself, which is checked here rather
     * than trusted.
     *
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function composedSnapshots(ComposedPlacement $placement, ?CarbonImmutable $on): array
    {
        $channel = SalesChannel::withoutTenancy()->whereKey($placement->salesChannelId)->first();

        if (! $channel instanceof SalesChannel) {
            return [[], [['reason' => 'channel_unknown', 'sales_channel_id' => $placement->salesChannelId]]];
        }

        $snapshots = [];
        $refusals = [];

        foreach ($placement->lines as $line) {
            $override = $line->price;

            $result = $this->probe->probe(
                $channel,
                $line->catalogueItemId,
                $line->catalogueItemVariantId,
                $line->quantity,
                $on,
                $placement->currencyCode,
                $placement->account,
            );

            $blocking = $override === null
                ? $result->refusals
                : array_values(array_filter(
                    $result->refusals,
                    static fn (array $refusal): bool => ! in_array($refusal['reason'] ?? null, ['unpriced', 'currency_mismatch'], true),
                ));

            if ($override !== null && $override->currencyCode !== $placement->currencyCode) {
                $blocking[] = [
                    'reason' => 'currency_mismatch',
                    'catalogue_item_id' => $line->catalogueItemId,
                    'expected_currency' => $placement->currencyCode,
                    'offered_currency' => $override->currencyCode,
                ];
            }

            $item = $result->item;

            if ($blocking !== [] || ! $item instanceof CatalogueItem) {
                foreach ($blocking as $refusal) {
                    $refusals[] = $refusal + ['catalogue_item_id' => $line->catalogueItemId];
                }

                continue;
            }

            $variant = $result->variant;
            $unitPriceMinor = $override === null ? $result->price?->amountMinor : $override->unitPriceMinor;

            if ($unitPriceMinor === null) {
                $refusals[] = ['reason' => 'unpriced', 'catalogue_item_id' => $line->catalogueItemId];

                continue;
            }

            // Minor units, so the rounding happens exactly once, at the line
            // total — the same arithmetic `repriced()` performs.
            $lineTotal = (int) round($unitPriceMinor * (float) $line->quantity);

            $snapshots[] = [
                'catalogue_item_id' => (string) $item->getKey(),
                'catalogue_item_variant_id' => $variant?->getKey() === null ? null : (string) $variant->getKey(),
                'name_en' => $item->name_en,
                'name_ar' => $item->name_ar,
                'variant_label' => $variant === null ? null : ($variant->name_en ?? $variant->code),
                'quantity' => $line->quantity,
                'unit_price_minor' => $unitPriceMinor,
                'line_total_minor' => $lineTotal,
                'currency_code' => $placement->currencyCode,
                'allergens' => $this->publicAllergens($item),
                'pack_summary' => $variant === null ? null : $this->packSummary((string) $variant->getKey()),
                // The tariff row is still recorded when there was one, even
                // behind an override: "which row said so today" is worth
                // knowing beside "what we actually charged".
                'price_list_id' => $result->price?->priceListId,
                'price_list_item_id' => $result->price?->priceListItemId,
                'price_source' => $override?->source,
            ];
        }

        return [$snapshots, $refusals];
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
    private function repriced(Cart $cart, array $lines, ?CarbonImmutable $on, CustomerAccount $buyer): array
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
                $buyer,
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
    private function addressReasons(string $customerAccountId, CustomerAddress $address): array
    {
        if ($address->customer_account_id !== $customerAccountId) {
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
     * Commercial terms that apply only to corporate buyers on private channels.
     *
     * The account is nullable because a counter sale may name nobody, and a
     * buyer who does not exist has no negotiated tariff — the same immediate
     * "not applicable" the three existing guards produce, reached one condition
     * earlier. Nullable rather than gated at the call site so that the composed
     * path can run this on all three fulfilment types without asking again what
     * "no buyer" means.
     *
     * @return list<array<string, mixed>>
     */
    private function agreementReasons(
        ?CustomerAccount $account,
        ?SalesChannel $channel,
        int $subtotalMinor,
        CarbonImmutable $on,
    ): array {
        if (! $account instanceof CustomerAccount
            || ! $channel instanceof SalesChannel
            || $account->account_type !== CustomerAccountType::B2b
            || $account->organisation_id === null
            || ! $channel->channel_kind->hasPrivatePricing()) {
            return [];
        }

        $agreement = $this->agreements->activeAgreementFor(
            $account->organisation_id,
            $channel->organisation_id,
            $on->startOfDay(),
        );

        if ($agreement === null) {
            return [[
                'reason' => 'agreement_required',
                'sales_channel_id' => (string) $channel->getKey(),
            ]];
        }

        $minimum = $agreement['minimum_order_minor'];

        if ($minimum !== null && $subtotalMinor < $minimum) {
            return [[
                'reason' => 'minimum_order_not_met',
                'minimum_order_minor' => $minimum,
                'subtotal_minor' => $subtotalMinor,
                'currency_code' => $agreement['currency_code'],
            ]];
        }

        // Credit exposure is not tracked yet — `credit_limit_minor` is enforced
        // once open-order exposure can be summed against the agreement.

        return [];
    }

    /**
     * @return array{agreement_id: string, price_list_id: string}|null
     */
    private function activeAgreementSnapshot(
        ?CustomerAccount $account,
        ?SalesChannel $channel,
        CarbonImmutable $on,
    ): ?array {
        if (! $account instanceof CustomerAccount
            || ! $channel instanceof SalesChannel
            || $account->account_type !== CustomerAccountType::B2b
            || $account->organisation_id === null
            || ! $channel->channel_kind->hasPrivatePricing()) {
            return null;
        }

        $agreement = $this->agreements->activeAgreementFor(
            $account->organisation_id,
            $channel->organisation_id,
            $on->startOfDay(),
        );

        if ($agreement === null) {
            return null;
        }

        return [
            'agreement_id' => $agreement['agreement_id'],
            'price_list_id' => $agreement['price_list_id'],
        ];
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
