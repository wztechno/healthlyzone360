<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\PaymentMethod;

/**
 * An order the platform composed on somebody's behalf — everything a placement
 * needs, with no basket behind it.
 *
 * **Why a basket could not be used instead.** `carts` carries a partial unique
 * index — one open cart per customer per channel — which is right for shopping
 * and fatal here: a subscriber filling their own basket on the web shop on the
 * morning their Tuesday delivery is generated would make the generation fail on
 * a unique violation, and the failure would look like a platform fault rather
 * than the collision it is. A transient cart would also have to be created,
 * converted and reconciled inside the same transaction, leaving a row in the
 * customer's basket history for something they never shopped for. The Order Desk
 * inherits the same answer for a harder reason: a walk-in has no customer to
 * hang a cart on at all.
 *
 * So the composed placement is its own shape, and every field a cart used to
 * supply is stated explicitly: the seller, the channel that prices and offers,
 * the branch that produces, and the currency the whole order is denominated in.
 * Nothing is inferred, because there is nothing left to infer it from.
 *
 * ## Three shapes, and the fields that make them differ
 *
 * `fulfilmentType` decides which of the other fields are required, forbidden or
 * merely allowed — the same three sentences `FulfilmentType` and
 * `orders_fulfilment_shape_check` state, arriving here as the *input* half of
 * the rule. `OrderPlacementService::shapeReasons()` is where they are enforced,
 * as refusals rather than as type errors, because a desk agent who picked the
 * wrong type deserves a sentence and not a 500.
 *
 *  * **`delivery`** — an account and an address, both required. Subscription
 *    generation and every cart checkout are this, and it is the default so that
 *    a caller who names no type composes the order the platform has always
 *    taken.
 *  * **`pickup`** — an account, **no address**, and still a promised slot: a
 *    pickup is cooked to a window like anything else, so the cut-off gate
 *    applies and `deliveryWindowCode`/`requestedDate` mean what they always
 *    meant.
 *  * **`counter`** — neither required. The account is *optional* (a regular is
 *    worth naming, a stranger is not) and the address is forbidden.
 *
 * ## `placedOnBehalfBy` is the staff marker, and there is no second one
 *
 * It carries the `users` identifier of the member of staff who took the order
 * for somebody else, and being non-null **is** what "a human at a desk placed
 * this" means — for the placement service, for `orders.placed_on_behalf_by`, and
 * for anything that later asks. A separate `bool $onBehalf` beside it would be a
 * second source of one truth, and the two would disagree the first time a caller
 * set one without the other: an order marked staff-placed with nobody named, or
 * a named agent the eligibility bypass ignored. One field cannot contradict
 * itself.
 *
 * The one behaviour it buys is that bypass. A desk order is placed *for* a cold
 * caller whose account was provisioned thirty seconds ago and satisfies no
 * activation checklist; the checklist exists to gate **self-service**, and a
 * member of staff standing in front of the customer is the verification it was
 * asking for. See `OrderPlacementService::composeNow()` for why the bypass is at
 * the call site rather than inside `CheckoutEligibility`.
 *
 * ## `paymentMethod` is captured intent
 *
 * It was hardcoded to `cash_on_delivery` in `persist()` for the whole of C1,
 * which was true of every order the platform could then take. A counter sale is
 * paid at the counter and a WISH transfer is neither — so the method is now
 * stated by the caller, defaulting to the one it used to be. What actually
 * arrived is `order_payment_receipts`, deliberately not constrained to agree.
 *
 * `requestedDate` is effectively required for a composed placement: a
 * subscription delivery is for one named day, and the branch cut-off cannot be
 * asked about a day nobody named. It is nullable only because the type mirrors
 * `place()`'s.
 */
final readonly class ComposedPlacement
{
    /**
     * @param  CustomerAccount|null  $account  required for delivery and pickup, optional for a counter sale
     * @param  CustomerAddress|null  $address  delivery only; a pickup or a counter sale carrying one is refused
     * @param  list<ComposedLine>  $lines
     * @param  string|null  $placedOnBehalfBy  the staff `users` id; non-null IS the staff marker
     */
    public function __construct(
        public ?CustomerAccount $account,
        public ?CustomerAddress $address,
        public string $organisationId,
        public string $salesChannelId,
        public ?string $branchId,
        public string $currencyCode,
        public array $lines,
        public ?string $deliveryWindowCode = null,
        public ?CarbonImmutable $requestedDate = null,
        public FulfilmentType $fulfilmentType = FulfilmentType::Delivery,
        public ?string $placedOnBehalfBy = null,
        public PaymentMethod $paymentMethod = PaymentMethod::CashOnDelivery,
    ) {}
}
