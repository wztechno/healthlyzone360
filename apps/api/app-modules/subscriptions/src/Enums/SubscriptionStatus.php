<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Enums;

/**
 * Where a subscription has got to.
 *
 * **Four states, and only two of them are reachable more than once.** The
 * approved semantics (§3) state the vocabulary exactly: `active → paused →
 * active`, `active|paused → cancelled` (terminal), and `balance exhausted →
 * completed` (terminal). Nothing else is an edge, and the two terminal states
 * are genuinely terminal — a cancelled subscription is not resumed, it is
 * replaced by a new one, because the price it was grandfathered at and the
 * credit memo its cancellation produced are both already settled facts.
 *
 * `completed` and `cancelled` are deliberately different terminals rather than
 * one `ended`. A subscription that ran its whole balance out and one that was
 * stopped early are different commercial events: the second one has a refund
 * attached and the first one has a renewal quote attached, and a single state
 * would make a report unable to tell them apart.
 *
 * The transition rule lives on the enum rather than in the service, so a second
 * caller cannot invent a fifth edge — the same construction `OrderStatus` uses.
 */
enum SubscriptionStatus: string
{
    case Active = 'active';
    case Paused = 'paused';
    case Cancelled = 'cancelled';
    case Completed = 'completed';

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
            self::Active => [self::Paused, self::Cancelled, self::Completed],
            self::Paused => [self::Active, self::Cancelled],
            self::Cancelled, self::Completed => [],
        };
    }

    /**
     * Whether deliveries may still be generated from it. Only `active` — a
     * paused subscription keeps its balance and generates nothing, which is
     * the whole point of pausing.
     */
    public function generates(): bool
    {
        return $this === self::Active;
    }

    /** Whether the customer still holds a live arrangement of any kind. */
    public function isLive(): bool
    {
        return $this === self::Active || $this === self::Paused;
    }

    public function isTerminal(): bool
    {
        return $this->allowedTransitions() === [];
    }
}
