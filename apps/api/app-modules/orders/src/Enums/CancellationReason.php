<?php

declare(strict_types=1);

namespace Healthy360\Orders\Enums;

/**
 * Why an order was cancelled.
 *
 * A fixed vocabulary rather than free text, because the answer is read by
 * machines as often as by people: a kitchen wants to know how many orders it
 * cancelled for stock and how many customers changed their minds, and free
 * text makes that a search problem instead of a count. Free text is also how
 * personal data ends up in a column nobody classified.
 *
 * Deliberately small. `CustomerRequested` and `KitchenUnableToFulfil` are the
 * two that actually happen; `DeliveryUnavailable` separates the case where the
 * food could be made but not delivered, because it is the kitchen's fault in a
 * different way and is the one an operations team can fix. `PaymentFailed` is
 * **not** here — there is nothing to fail, orders are paid at the door — and
 * inventing it now would be reserving a value for a phase that has not
 * designed it.
 */
enum CancellationReason: string
{
    case CustomerRequested = 'customer_requested';
    case KitchenUnableToFulfil = 'kitchen_unable_to_fulfil';
    case DeliveryUnavailable = 'delivery_unavailable';
    case AddressUnreachable = 'address_unreachable';
}
