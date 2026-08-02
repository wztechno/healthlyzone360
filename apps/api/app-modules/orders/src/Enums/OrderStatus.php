<?php

declare(strict_types=1);

namespace Healthy360\Orders\Enums;

/**
 * Where an order has got to.
 *
 * **Four states, one forward path and one exit.** `placed → confirmed →
 * fulfilled`, with `cancelled` reachable from `placed` and `confirmed` and
 * from nowhere else. A fulfilled order is not cancellable — the food has been
 * delivered, and whatever happens next is a refund or a complaint, which are
 * different objects with different money attached. Making that a state
 * transition would let a kitchen erase a delivery by changing a column.
 *
 * The states this phase deliberately does **not** have: nothing about payment
 * (there is one payment method and it happens at the door), nothing about
 * production stages (that is the kitchen display's vocabulary, F1/KDS), and no
 * `pending` or `draft` — an order that has not been placed is a cart.
 *
 * The transition rule lives on this enum rather than in the service, so that
 * a second caller cannot invent a fifth edge.
 */
enum OrderStatus: string
{
    case Placed = 'placed';
    case Confirmed = 'confirmed';
    case Fulfilled = 'fulfilled';
    case Cancelled = 'cancelled';

    /**
     * Whether this order may move to the given state.
     */
    public function canTransitionTo(self $next): bool
    {
        return in_array($next, $this->allowedTransitions(), true);
    }

    /**
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Placed => [self::Confirmed, self::Cancelled],
            self::Confirmed => [self::Fulfilled, self::Cancelled],
            self::Fulfilled, self::Cancelled => [],
        };
    }

    /** Whether the order is still moving — the shape J2 asks about. */
    public function isOpen(): bool
    {
        return $this === self::Placed || $this === self::Confirmed;
    }

    public function isTerminal(): bool
    {
        return $this->allowedTransitions() === [];
    }
}
