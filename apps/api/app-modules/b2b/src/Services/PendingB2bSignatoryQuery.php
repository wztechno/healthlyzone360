<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bOffboarding;
use Healthy360\Customers\Closure\Contracts\B2bSignatoryPresence;

/**
 * "Is this person on the hook as a B2B signatory?"
 *
 * **J2's port, implemented here.** The closure journey asks it as a blocker:
 * a person who is the named signatory on a live corporate agreement, or the
 * one an in-flight offboarding is waiting on, cannot close their personal
 * account and vanish. There would be a company with nobody able to sign it out
 * — and the signatory OTP would have no destination, which turns a wind-up
 * into a support ticket.
 *
 * The direction is right: Customers declares the question because Customers
 * needs the answer, and B2B answers because only B2B knows what a signatory
 * is. Read-only, over two of this module's own tables, and it returns
 * *reasons* rather than agreements — a closure screen needs to say "you are
 * the signatory for Acme Ltd", not render an agreement's credit limit.
 *
 * ## The seam, closed
 *
 * J2's port turned out to be named `B2bSignatoryPresence` and to live in
 * `Healthy360\Customers\Closure\Contracts` — B2 wrote its note against a
 * working name, which is what happens when two phases are built in parallel.
 * The reconciliation is on **this** side, as B2's own note instructed: the port
 * belongs to the module that asks, so `pendingSignatureCount()` and
 * `isAvailable()` are added here rather than the customers interface being bent
 * to fit. `hasPendingObligations()` and `pendingObligations()` stay exactly as
 * they were — they are richer than the port needs and are what a B2B-side
 * caller would reach for — and the two interface methods are expressed over
 * them.
 *
 * `isAvailable()` is true unconditionally, for the reason every adapter over
 * one of these ports gives: the question is "is a B2B module bound", and the
 * only way this class is reached is that one is.
 *
 * Bound in `B2bServiceProvider`, over the `NullB2bSignatoryPresence` the
 * customers module registers with `bindIf`.
 */
final readonly class PendingB2bSignatoryQuery implements B2bSignatoryPresence
{
    public function isAvailable(): bool
    {
        return true;
    }

    /**
     * How many companies are waiting on this person's signature.
     *
     * The port's method, expressed over this class's own richer answer rather
     * than as a second query: two counts of the same thing computed two ways is
     * how a blocker and the screen explaining it come to disagree.
     */
    public function pendingSignatureCount(string $userId): int
    {
        return count($this->pendingObligations($userId));
    }

    /**
     * Whether closing this person's account would strand a company.
     */
    public function hasPendingObligations(string $userId): bool
    {
        return $this->pendingObligations($userId) !== [];
    }

    /**
     * What this person is on the hook for, in enough detail to explain a
     * refusal and no more.
     *
     * Two kinds of obligation, and they are genuinely different. An **active
     * agreement** means they are the standing signatory for a company that is
     * still trading; the fix is for the company to amend the agreement and
     * name somebody else. An **offboarding awaiting sign-off** is more urgent
     * and more specific: a wind-up is already running and is waiting on this
     * person's passcode, and closing their account would leave it stuck.
     *
     * @return list<array{
     *     obligation: string,
     *     organisation_id: string|null,
     *     subject_id: string,
     *     status: string
     * }>
     */
    public function pendingObligations(string $userId): array
    {
        $obligations = [];

        $agreements = B2bAgreement::query()
            ->where('signatory_user_id', $userId)
            ->whereIn('status', [AgreementStatus::Active->value, AgreementStatus::PendingSignature->value])
            ->get();

        foreach ($agreements as $agreement) {
            $obligations[] = [
                'obligation' => 'b2b_agreement_signatory',
                'organisation_id' => $agreement->organisation_id,
                'subject_id' => (string) $agreement->getKey(),
                'status' => $agreement->status->value,
            ];
        }

        $offboardings = B2bOffboarding::query()
            ->whereIn('status', [
                OffboardingStatus::NoticeServed->value,
                OffboardingStatus::SettlementPending->value,
                OffboardingStatus::AwaitingSignoff->value,
            ])
            ->whereHas('agreement', static fn ($query) => $query->where('signatory_user_id', $userId))
            ->get();

        foreach ($offboardings as $offboarding) {
            $obligations[] = [
                'obligation' => 'b2b_offboarding_signoff',
                'organisation_id' => $offboarding->organisation_id,
                'subject_id' => (string) $offboarding->getKey(),
                'status' => $offboarding->status->value,
            ];
        }

        return $obligations;
    }
}
