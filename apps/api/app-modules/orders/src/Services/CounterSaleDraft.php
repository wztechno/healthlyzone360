<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Enums\PaymentMethod;

/**
 * Everything a walk-in sale is, stated once.
 *
 * `ComposedPlacement` says what a *placement* needs; this says what a **whole
 * counter sale** needs, which is that plus the two facts a placement has no
 * column for: who took the money, and what they wrote down beside it.
 * `CounterSale::complete()` turns one of these into an order that is placed,
 * confirmed, receipted and fulfilled, and having the inputs in one immutable
 * object is what lets that method read as four steps rather than as fourteen
 * arguments.
 *
 * ## `fulfilmentType` is absent, and that is the point
 *
 * A draft is a counter sale by construction. `CounterSale::complete()` composes
 * `FulfilmentType::Counter` itself, so there is no field here a caller could set
 * to `delivery` and no way to reach the delivery path through this object. The
 * `address` is missing for the same reason: `orders_fulfilment_shape_check`
 * refuses a counter sale carrying one, and a field that may only ever be null is
 * a field that exists to be got wrong.
 *
 * ## `account` is optional, and `placedOnBehalfBy` is not
 *
 * The asymmetry is `FulfilmentType::Counter`'s own: the desk may know *who* and
 * must never claim *where*. A regular is worth naming and a stranger is not, so
 * `account` is nullable and the order simply carries no customer.
 *
 * `placedOnBehalfBy` is a plain `string` rather than a nullable one, and that
 * type is load-bearing. It is the idempotency **subject** for a composed staff
 * placement — see `OrderPlacementService::composedSubject()` — and a counter
 * sale is the one shape on the platform that may name no customer at all. A
 * draft composed with no agent would therefore key on nobody, `OrderIdempotency`
 * would decline to protect it, and a double-tapped sale would place a second
 * order, deduct a second set of ingredients and receipt a second payment with
 * nothing in the schema to notice. The key is the only guard there is, so the
 * subject that makes it work is not optional.
 *
 * ## There is no amount
 *
 * The receipt this draft produces is for exactly `orders.total_minor`, computed
 * by the placement from the standing tariff, and there is deliberately no field
 * here to disagree with it. A counter sale is settled in the room, in full,
 * before the customer walks away with the food — that is what "counter" means —
 * so the amount is not an input, it is the total.
 *
 * **A discrepancy at the till is a till problem, not an order problem.** If the
 * drawer is short at the end of the shift, the order was still for what the
 * order was for; rewriting the receipt to match the cash would make the sale
 * unreconcilable against the tariff that produced it. Part payments and
 * over-payments are real elsewhere and arrive the way they always have — through
 * `POST /catalogue/orders/{order}/payments`, afterwards, as their own rows, with
 * their own `confirmed_by`. Giving the counter path an amount field would let a
 * desk agent quietly settle a $50 sale for $5 with one keystroke and no second
 * person in the loop.
 *
 * `reference` and `notes` are carried because they are how a WISH transfer is
 * identified and how a counter is explained, and both are bounded by the
 * request that fills them (`120` and `300`, the columns' own widths).
 */
final readonly class CounterSaleDraft
{
    /**
     * @param  CustomerAccount|null  $account  the regular the desk chose to name; null for a stranger
     * @param  list<ComposedLine>  $lines  already aggregated by `DeskBasket`; `order_lines` is unique per article
     * @param  string  $placedOnBehalfBy  the agent's `users` id — the idempotency subject, never null
     * @param  string|null  $idempotencyKey  the caller's replay key, carried through to `placeComposed()`
     */
    public function __construct(
        public string $organisationId,
        public string $salesChannelId,
        public ?string $branchId,
        public string $currencyCode,
        public array $lines,
        public string $placedOnBehalfBy,
        public PaymentMethod $paymentMethod,
        public ?CustomerAccount $account = null,
        public ?string $reference = null,
        public ?string $notes = null,
        public ?string $idempotencyKey = null,
    ) {}
}
