<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * The states a corporate relationship passes through on its way out
 * (appendix C, B.6).
 *
 * **B1 declared six; B2 adds three, and adds rather than renames.** The shell
 * shipped `requested → notice_served → settlement_pending → signed_off →
 * revoking → completed` with a database CHECK behind it, and renaming any of
 * those would mean rewriting rows in a deployed schema to gain nothing. What
 * was genuinely missing is three moments the B1 vocabulary had no word for:
 *
 * - **`awaiting_signoff`** — settlement is resolved and the platform is
 *   waiting on a human. B1 collapsed this into `settlement_pending`, which
 *   made "the checks are still running" and "the checks passed a week ago and
 *   nobody has signed" the same status. Those need different chasing.
 * - **`archiving`** — access is gone and the personal-data purge is running.
 *   Separate from `completed` for exactly the reason `revoking` is: the purge
 *   touches documents and contact rows and can partially fail, and a status
 *   that folded it into the terminal state would let a half-purged
 *   organisation read as finished.
 * - **`cancelled`** — the company changed its mind, or notice was served in
 *   error. Every pre-revocation state can reach it and no state can leave it.
 *   Without it the only way out of a mistaken offboarding was to drive it to
 *   completion and close an organisation nobody meant to close.
 *
 * `requested` survives as the column default and as the state of a row created
 * outside `OffboardingService`. The service never writes it — `start()` serves
 * notice in the same act, because applying the agreement's notice period *is*
 * what starting an offboarding means — so a row sitting in `requested` is a
 * row something else made, and that is worth being able to see.
 *
 * `settlement_pending` is honest about a gap rather than hiding it. There is
 * no invoicing to settle against until PAY1, so `SettlementRegistry` reports
 * `not_applicable` with the reason `invoicing_module_absent` rather than a
 * permanently-green tick that quietly stops being true the day PAY1 lands.
 */
enum OffboardingStatus: string
{
    /** Created outside the service. `start()` never writes this. */
    case Requested = 'requested';

    /** Notice has been served; the notice period is running. */
    case NoticeServed = 'notice_served';

    /** Settlement checks are outstanding, or one came back unclear. */
    case SettlementPending = 'settlement_pending';

    /** Settlement resolved. Waiting on the signatory's passcode. */
    case AwaitingSignoff = 'awaiting_signoff';

    /** The signatory has signed off. Revocation has not started. */
    case SignedOff = 'signed_off';

    /** Ending every membership. The step that can partially fail. */
    case Revoking = 'revoking';

    /** Access is gone; personal data is being purged. */
    case Archiving = 'archiving';

    case Completed = 'completed';

    /** Stopped before it finished. Nothing was revoked. */
    case Cancelled = 'cancelled';

    public function isTerminal(): bool
    {
        return $this === self::Completed || $this === self::Cancelled;
    }

    /**
     * Whether access has already been taken away.
     *
     * The dividing line for cancellation: an offboarding may be called off
     * right up to the moment memberships start ending, and not afterwards.
     * "Cancelling" a revocation would mean silently re-granting access
     * somebody deliberately removed, which is a different act and needs a
     * different door.
     */
    public function hasRevoked(): bool
    {
        return in_array($this, [self::Revoking, self::Archiving, self::Completed], true);
    }

    /**
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Requested => [self::NoticeServed, self::Cancelled],
            self::NoticeServed => [self::SettlementPending, self::Cancelled],
            // Back to itself: a check that came back unclear is re-run once the
            // company has paid, and the re-run must not need a state change to
            // be legal.
            self::SettlementPending => [self::SettlementPending, self::AwaitingSignoff, self::Cancelled],
            self::AwaitingSignoff => [self::SignedOff, self::Cancelled],
            self::SignedOff => [self::Revoking, self::Cancelled],
            self::Revoking => [self::Archiving],
            // Back to itself: the purge is re-runnable, because a partial
            // failure has to be retried rather than declared finished.
            self::Archiving => [self::Archiving, self::Completed],
            self::Completed, self::Cancelled => [],
        };
    }

    public function canTransitionTo(self $next): bool
    {
        return in_array($next, $this->allowedTransitions(), true);
    }
}
