<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bOffboarding;

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
 * ## For integrator-2
 *
 * J2 declares `Healthy360\Customers\Contracts\PendingB2bSignatory` in the
 * customers module with a null default. This class is written to that shape
 * but does **not** yet name it in an `implements` clause, because the two
 * phases were built in parallel and B2 must not fail static analysis on a
 * contract that has not landed. Two lines close it:
 *
 * ```php
 * // 1. this class:
 * final readonly class PendingB2bSignatoryQuery implements PendingB2bSignatory
 *
 * // 2. B2bServiceProvider::boot():
 * $this->app->bind(PendingB2bSignatory::class, PendingB2bSignatoryQuery::class);
 * ```
 *
 * If J2's method names differ from `hasPendingObligations()` /
 * `pendingObligations()`, rename here rather than in customers — the port
 * belongs to the module that asks.
 */
final readonly class PendingB2bSignatoryQuery
{
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
