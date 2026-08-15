<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Services;

use Carbon\CarbonImmutable;

/**
 * How long a closure waits before it becomes irreversible.
 *
 * **The default is zero, and that is a product decision rather than an
 * oversight.** A person who has decided to be forgotten should not be told to
 * come back in a week; the "cooling-off period" pattern is, more often than
 * not, a retention tactic wearing a safety argument. So by default a verified
 * closure finalises on the spot.
 *
 * It is configuration rather than a constant because the argument goes the
 * other way in two real cases — a jurisdiction that requires a reflection
 * period, and an operator who has just been through a wave of account takeovers
 * and wants a day in which a hijacked account's real owner can cancel. Both are
 * legitimate, neither should need a deploy, and a zero-length window must not
 * be a different code path from a positive one or the positive one will be the
 * one nobody tests.
 *
 * Every number here is PROVISIONAL pending the retention decision (OQ-002 /
 * OQ-029) and is named as configuration, never as a settled legal period.
 */
final class ClosureWindows
{
    /**
     * Hours between a verified closure and its finalisation.
     *
     * Clamped at zero: a negative window would schedule finalisation in the
     * past, which the sweep would honour immediately and which would read in
     * the request row as a closure that was due before it was asked for.
     */
    public function graceHours(): int
    {
        return max(0, (int) config('closure.grace.hours', 0));
    }

    /**
     * When a closure verified now becomes due.
     */
    public function dueAt(?CarbonImmutable $from = null): CarbonImmutable
    {
        return ($from ?? CarbonImmutable::now())->addHours($this->graceHours());
    }

    /**
     * Whether a customer can still call a scheduled closure off.
     *
     * True whenever there is a window to cancel inside. With a zero-length
     * window there is no interval in which to change one's mind, and saying
     * otherwise would be advertising an undo that the clock never permits.
     */
    public function allowsCancellation(): bool
    {
        return $this->graceHours() > 0;
    }

    /**
     * How long a completed closure request row is kept before it is pruned.
     *
     * Not consumed here — no sweep deletes these rows yet, and inventing one
     * would be fabricating a retention decision nobody has taken. The setting
     * exists so the number has one home when the decision arrives.
     */
    public function requestRetentionDays(): int
    {
        return max(0, (int) config('closure.retention.request_rows_days', 365));
    }
}
