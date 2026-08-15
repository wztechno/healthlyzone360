<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Enums;

/**
 * Where a closure request has got to.
 *
 * `requested` is asked but unproven. `verified` is the passcode accepted and
 * the challenge bound to this request. `scheduled` is the grace window
 * running — the state that exists so "I changed my mind" has somewhere to land.
 * `completed` and `cancelled` are terminal, and the transitions between them
 * are declared here rather than in the service that performs them so that
 * "can a completed closure be cancelled" has one answer a reader can find.
 *
 * A zero-length grace window (the configured default) does not remove
 * `scheduled`; it makes it instantaneous. The state stays in the vocabulary
 * because the window is configuration and an operator who lengthens it must not
 * be introducing a state the state machine has never seen.
 */
enum ClosureRequestStatus: string
{
    case Requested = 'requested';

    case Verified = 'verified';

    case Scheduled = 'scheduled';

    case Completed = 'completed';

    case Cancelled = 'cancelled';

    /**
     * Whether the request is still going somewhere.
     *
     * What the one-live-request index is built on, and what a second closure
     * attempt is refused against.
     */
    public function isLive(): bool
    {
        return in_array($this, [self::Requested, self::Verified, self::Scheduled], true);
    }

    /**
     * Whether the person may still call it off.
     *
     * Up to and including `scheduled`. Once finalisation has run there is
     * nothing left to cancel — the data is gone — and saying otherwise would be
     * offering an undo that does not exist.
     */
    public function isCancellable(): bool
    {
        return $this->isLive();
    }

    public function canTransitionTo(self $next): bool
    {
        if ($this === $next) {
            return false;
        }

        return match ($this) {
            self::Requested => in_array($next, [self::Verified, self::Completed, self::Cancelled], true),
            self::Verified => in_array($next, [self::Scheduled, self::Completed, self::Cancelled], true),
            self::Scheduled => in_array($next, [self::Completed, self::Cancelled], true),
            self::Completed, self::Cancelled => false,
        };
    }
}
