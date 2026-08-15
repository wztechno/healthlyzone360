<?php

declare(strict_types=1);

namespace Healthy360\Orders\Enums;

/**
 * How an order leaves the kitchen.
 *
 * **Three cases, and each one is a different set of facts the order must
 * carry.** That is what makes this a vocabulary rather than a flag: the type
 * does not describe a preference, it decides which columns on the row are
 * required, which are forbidden, and which gates a placement has to pass.
 * `orders_fulfilment_shape_check` states the column half of that in the
 * database, so the two cannot drift.
 *
 *  * `delivery` — a courier takes it to a door. A customer and an address, both
 *    required. The only way this platform sold anything before the Order Desk,
 *    and still how most orders leave.
 *  * `pickup` — the customer collects it. A customer, a **promised slot**, and
 *    deliberately **no address**: "be here at six" is a promise whether or not
 *    the food travels, but a destination on an order nobody is delivering is a
 *    courier instruction that will never be followed.
 *  * `counter` — somebody bought lunch at the desk. The customer is
 *    **optional** — a regular is worth naming, a stranger is not — and the
 *    address is forbidden. The desk may know *who* and must never claim
 *    *where*, which is the asymmetry that makes this its own case rather than
 *    "pickup without an account".
 *
 * `delivery` is the default in the schema and the default here in effect: an
 * order whose type nobody named is one somebody has to take somewhere, which
 * is the conservative reading of a missing value rather than the convenient
 * one.
 *
 * What this enum is **not** is a delivery *status*. Where an order has got to
 * is `OrderStatus`, which moves; this never moves after placement. An order
 * taken for delivery and collected by an impatient customer is a delivery order
 * that was handed over early, not a pickup — rewriting the type would make the
 * fee already snapshotted on the row unexplainable.
 */
enum FulfilmentType: string
{
    case Delivery = 'delivery';

    case Pickup = 'pickup';

    case Counter = 'counter';

    /**
     * Whether an order of this type must name a customer account.
     *
     * True for delivery and pickup, false for counter — the shape CHECK's
     * customer arm, restated for the callers that have to refuse *before* the
     * database does. `counter` returning false is the whole point: it means
     * "optional", never "forbidden".
     */
    public function requiresCustomer(): bool
    {
        return $this !== self::Counter;
    }

    /**
     * Whether an order of this type carries a delivery address snapshot.
     *
     * True for delivery alone. Both other arms of the shape CHECK demand
     * `delivery_line_one IS NULL`, so this is the one predicate that decides
     * whether the whole snapshot block — the lines, the building, the floor,
     * the directions, the contact point — is written at all.
     */
    public function requiresAddress(): bool
    {
        return $this === self::Delivery;
    }

    /**
     * @return list<string>
     */
    public static function codes(): array
    {
        return array_map(static fn (self $type): string => $type->value, self::cases());
    }
}
