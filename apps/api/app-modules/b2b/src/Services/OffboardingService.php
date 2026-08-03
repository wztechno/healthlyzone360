<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\B2b\Enums\OffboardingTrigger;
use Healthy360\B2b\Enums\SettlementOutcome;
use Healthy360\B2b\Enums\SettlementStatus;
use Healthy360\B2b\Exceptions\OffboardingRefused;
use Healthy360\B2b\Jobs\RevokeBusinessAccess;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Models\B2bOffboarding;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Verification\Enums\OtpChallengeStatus;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Results\OtpChallengeResult;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Ending a corporate relationship, one deliberate step at a time.
 *
 * Seven acts, each of which somebody has to choose to perform: `start`,
 * `runSettlementChecks`, `waiveSettlement`, `issueSignoffChallenge`,
 * `signOff`, `revokeAccess`, `archive` — and `cancel`, which can interrupt any
 * of them before access has been taken away.
 *
 * **Nothing here cascades.** It would be shorter to have `signOff()` revoke
 * and archive in one transaction, and it would be wrong: revocation ends
 * people's access to a system they use for work, and the platform should have
 * to be told to do it rather than doing it as a side effect of a signature.
 * The states exist so that an operator can see where a wind-up has stalled,
 * and a method that skipped three of them would make the states decorative.
 *
 * ## Notice, and why it is copied
 *
 * `start()` reads `notice_period_days` from the agreement in force and falls
 * back to `b2b.offboarding.default_notice_period_days` (30, OQ-032) when the
 * agreement is silent. The number is **copied onto the offboarding row**, not
 * read through the agreement later, so that an amendment signed next week
 * cannot shorten notice that has already been served. `effective_on` is
 * computed once from it, for the same reason.
 *
 * ## Settlement
 *
 * `runSettlementChecks()` delegates to `SettlementRegistry`, which is honest
 * about what it cannot check. A clear assessment moves the offboarding to
 * `awaiting_signoff` with `settlement_status = cleared`; a blocked one leaves
 * it in `settlement_pending` and the summary of what blocked it on the row.
 * Re-running is legal and expected — the company pays, somebody runs it again.
 *
 * `waiveSettlement()` is the escape hatch and is treated as one. It demands an
 * authorisation callback the caller supplies (the permission code itself is
 * integrator-2's), demands a written reason, refuses without either, and
 * writes its own audit action rather than sharing `settlement_cleared`. A
 * waiver recorded as a clearance would erase the only difference that matters
 * later.
 *
 * ## Sign-off
 *
 * `issueSignoffChallenge()` sends a `b2b_signatory` passcode to the contact of
 * the person the agreement names as signatory — not to whoever is driving the
 * offboarding. `signOff()` then demands a challenge that exists, carries that
 * purpose, has been *consumed*, and belongs to the person signing, exactly as
 * `AgreementService::sign()` does. All four failures answer identically, so a
 * caller holding somebody else's challenge identifier learns only that it did
 * not work.
 *
 * ## Archiving — what goes, and what stays
 *
 * `archive()` purges personal data and **retains the legal entity**. The
 * application's company fields — legal name, registration number, tax
 * number, incorporation date — survive, because a corporate record carries
 * retention obligations the people named on it do not. What is nulled is the
 * humans: named contacts' names, emails, phones and notes, and the signatory
 * block on the application. KYC documents are not deleted here either; their
 * `purge_after` is brought forward so `PurgeExpiredKycDocuments` removes them
 * on its own schedule, through the one code path that knows to delete the
 * object before the row.
 */
final readonly class OffboardingService
{
    /** What replaces a purged contact's name, so the row reads as purged rather than blank. */
    private const string PURGED_MARKER = '[purged]';

    public function __construct(
        private SettlementRegistry $settlement,
        private OtpService $otp,
        private AuditRecorder $audit,
    ) {}

    /**
     * Serve notice and open the wind-up.
     *
     * @throws OffboardingRefused
     */
    public function start(
        Organisation $organisation,
        OffboardingTrigger $trigger,
        User $actor,
        ?string $reasonNote = null,
        ?CarbonImmutable $effectiveOn = null,
    ): B2bOffboarding {
        $this->assertCorporateCustomer($organisation);

        $agreement = $this->activeAgreementFor($organisation);

        if (! $agreement instanceof B2bAgreement) {
            throw OffboardingRefused::noActiveAgreement();
        }

        return DB::transaction(function () use ($organisation, $agreement, $trigger, $actor, $reasonNote, $effectiveOn): B2bOffboarding {
            $open = B2bOffboarding::query()
                ->where('organisation_id', $organisation->getKey())
                ->whereNotIn('status', [OffboardingStatus::Completed->value, OffboardingStatus::Cancelled->value])
                ->lockForUpdate()
                ->first();

            if ($open instanceof B2bOffboarding) {
                // The partial unique index says the same thing. Refusing here
                // means the caller gets a message rather than a constraint
                // violation, and the index stays as the thing nothing can
                // route around.
                throw OffboardingRefused::alreadyInFlight((string) $organisation->getKey());
            }

            $noticeDays = $agreement->notice_period_days ?? $this->defaultNoticeDays();
            $now = CarbonImmutable::now();

            $offboarding = new B2bOffboarding;
            $offboarding->organisation_id = (string) $organisation->getKey();
            $offboarding->b2b_agreement_id = (string) $agreement->getKey();
            $offboarding->status = OffboardingStatus::NoticeServed;
            $offboarding->trigger = $trigger;
            $offboarding->reason = $trigger->value;
            $offboarding->reason_note = $reasonNote === null || trim($reasonNote) === '' ? null : trim($reasonNote);
            $offboarding->requested_by = (string) $actor->getKey();
            $offboarding->requested_at = $now;
            $offboarding->notice_period_days = $noticeDays;
            $offboarding->notice_served_at = $now;
            $offboarding->effective_on = $effectiveOn ?? $now->addDays($noticeDays)->startOfDay();
            $offboarding->settlement_status = SettlementStatus::Pending;
            $offboarding->lock_version = 0;
            $offboarding->save();

            $this->audit->record(
                'b2b.offboarding_started',
                actorUserId: (string) $actor->getKey(),
                subjectType: 'b2b_offboarding',
                subjectId: (string) $offboarding->getKey(),
                metadata: [
                    'organisation_id' => (string) $organisation->getKey(),
                    'b2b_agreement_id' => (string) $agreement->getKey(),
                    'trigger' => $trigger->value,
                    'notice_period_days' => $noticeDays,
                    'notice_from_agreement' => $agreement->notice_period_days !== null,
                    'effective_on' => $offboarding->effective_on->toDateString(),
                ],
            );

            return $offboarding;
        });
    }

    /**
     * Run every settlement check and record what each one found.
     *
     * @throws OffboardingRefused
     */
    public function runSettlementChecks(B2bOffboarding $offboarding, User $actor): B2bOffboarding
    {
        $organisation = $offboarding->organisation;

        if (! $organisation instanceof Organisation) {
            throw OffboardingRefused::notCorporate();
        }

        $this->assertCanTransition($offboarding, OffboardingStatus::SettlementPending);

        $assessment = $this->settlement->assess($organisation);
        $now = CarbonImmutable::now();

        $offboarding->settlement_checks = $assessment->toArray();
        $offboarding->settlement_started_at ??= $now;
        $offboarding->settlement_note = $this->settlementNote($assessment);

        // Into `settlement_pending` first, always — including when everything
        // is clear. Two audit rows rather than one, because "the checks ran"
        // and "settlement resolved" are separate facts and a wind-up that
        // jumped straight to `awaiting_signoff` would leave no record that
        // anything was ever checked.
        $this->transition($offboarding, OffboardingStatus::SettlementPending, $actor, [], [
            'blockers' => $assessment->blockerNames(),
            'checks_unavailable' => $assessment->unavailableReasons(),
            'settlement_status' => $offboarding->settlement_status->value,
        ], action: 'b2b.offboarding_settlement_checked');

        if (! $assessment->isClear()) {
            return $offboarding;
        }

        $offboarding->settlement_status = SettlementStatus::Cleared;
        $offboarding->settlement_resolved_at = $now;

        $this->transition($offboarding, OffboardingStatus::AwaitingSignoff, $actor, [
            'awaiting_signoff_at' => $now,
        ], [
            'settlement_status' => SettlementStatus::Cleared->value,
            'checks_unavailable' => $assessment->unavailableReasons(),
        ]);

        return $offboarding;
    }

    /**
     * Set aside an outstanding settlement position.
     *
     * `$authorises` is the caller's gate rather than a permission code read
     * here, because B2's permission vocabulary is the integration wave's to
     * declare (master plan v2 §4.16). What this service insists on is that
     * *some* gate was consulted — the argument is required, not optional, so a
     * call site cannot default it to true by omission.
     *
     * @param  callable(): bool  $authorises
     *
     * @throws OffboardingRefused
     */
    public function waiveSettlement(B2bOffboarding $offboarding, User $actor, string $reason, callable $authorises): B2bOffboarding
    {
        if (! $authorises()) {
            throw OffboardingRefused::waiverNotPermitted();
        }

        $trimmed = trim($reason);

        if ($trimmed === '') {
            throw OffboardingRefused::waiverNeedsReason();
        }

        $this->assertCanTransition($offboarding, OffboardingStatus::AwaitingSignoff);

        $now = CarbonImmutable::now();

        $offboarding->settlement_status = SettlementStatus::Waived;
        $offboarding->settlement_waived_by = (string) $actor->getKey();
        $offboarding->settlement_waiver_reason = $trimmed;
        $offboarding->settlement_resolved_at = $now;
        $offboarding->settlement_started_at ??= $now;

        // Its own action, never `settlement_cleared`. A waiver recorded as a
        // clearance erases the only difference a dispute turns on.
        $this->transition($offboarding, OffboardingStatus::AwaitingSignoff, $actor, [
            'awaiting_signoff_at' => $now,
        ], [
            'settlement_status' => SettlementStatus::Waived->value,
            'waiver_reason_given' => true,
            'blockers_at_waiver' => $this->blockersOnRecord($offboarding),
        ], action: 'b2b.offboarding_settlement_waived');

        return $offboarding;
    }

    /**
     * Send the signatory a passcode.
     *
     * To the *agreement's* signatory, resolved through their login contact —
     * never to whoever happens to be driving the offboarding. The person who
     * signed a company in is the person who signs it out, and letting the
     * operator nominate the destination would make the passcode a formality.
     *
     * @throws OffboardingRefused
     */
    public function issueSignoffChallenge(B2bOffboarding $offboarding, ?string $locale = null, ?string $requestIpHash = null): OtpChallengeResult
    {
        if ($offboarding->status !== OffboardingStatus::AwaitingSignoff) {
            throw OffboardingRefused::illegalTransition($offboarding->status, OffboardingStatus::SignedOff);
        }

        $contact = $this->signatoryContactFor($offboarding);

        if (! $contact instanceof ContactPoint) {
            throw OffboardingRefused::noSignatoryContact();
        }

        return $this->otp->issue($contact, OtpPurpose::B2bSignatory, locale: $locale, requestIpHash: $requestIpHash);
    }

    /**
     * Record the signatory's acceptance, against a passcode already spent.
     *
     * @throws OffboardingRefused
     */
    public function signOff(B2bOffboarding $offboarding, OffboardingSignoff $evidence, User $actor): B2bOffboarding
    {
        $this->assertCanTransition($offboarding, OffboardingStatus::SignedOff);

        if (! $offboarding->settlement_status->permitsSignoff()) {
            throw OffboardingRefused::settlementOutstanding($this->blockersOnRecord($offboarding));
        }

        $challenge = $this->provenSignatoryChallenge($evidence, $actor);
        $evidence = $evidence->proved((string) $challenge->getKey());

        $offboarding->signoff_challenge_id = $evidence->otpChallengeId;
        $offboarding->signoff_signatory_name = $evidence->signatoryName;
        $offboarding->signoff_signatory_title = $evidence->signatoryTitle;
        $offboarding->signoff_document_sha256 = $evidence->documentSha256;
        $offboarding->signoff_consent_statement = $evidence->consentStatement;
        $offboarding->signoff_ip_hash = $evidence->ipHash;
        $offboarding->signoff_user_agent_hash = $evidence->userAgentHash;

        if (! $offboarding->hasSignoffEvidence()) {
            throw OffboardingRefused::signoffEvidenceIncomplete();
        }

        $this->transition($offboarding, OffboardingStatus::SignedOff, $actor, [
            'signed_off_at' => CarbonImmutable::now(),
            'signed_off_by' => (string) $actor->getKey(),
        ], [
            'otp_verified' => $evidence->otpVerified,
            'signoff_challenge_id' => $evidence->otpChallengeId,
            'settlement_status' => $offboarding->settlement_status->value,
        ]);

        return $offboarding;
    }

    /**
     * Start taking access away.
     *
     * The transition is written here and the work is done by
     * `RevokeBusinessAccess`, because ending every membership in an
     * organisation, deleting tokens and closing the organisation is more work
     * than a request should hold — and because a queued job can be retried,
     * which is the property the one step that can partially fail most needs.
     *
     * @throws OffboardingRefused
     */
    public function revokeAccess(B2bOffboarding $offboarding, User $actor): B2bOffboarding
    {
        $this->assertCanTransition($offboarding, OffboardingStatus::Revoking);

        $this->transition($offboarding, OffboardingStatus::Revoking, $actor, [
            'revocation_started_at' => CarbonImmutable::now(),
        ]);

        RevokeBusinessAccess::dispatch((string) $offboarding->getKey(), (string) $actor->getKey());

        return $offboarding;
    }

    /**
     * Purge the people, keep the company.
     *
     * Re-runnable on purpose: `archiving → archiving` is a legal transition,
     * so a partial failure is retried rather than declared finished. Every
     * write below is idempotent — nulling an already-null column and bringing
     * forward an already-past `purge_after` both do nothing the second time.
     *
     * @throws OffboardingRefused
     */
    public function archive(B2bOffboarding $offboarding, User $actor): B2bOffboarding
    {
        $now = CarbonImmutable::now();
        $offboarding->archiving_started_at ??= $now;

        // Into `archiving` before anything is purged, so a crash mid-purge
        // leaves a status that says what was happening rather than one that
        // still says access was being revoked.
        $this->transition($offboarding, OffboardingStatus::Archiving, $actor);

        $summary = DB::transaction(function () use ($offboarding, $now): array {
            $application = $this->applicationFor($offboarding);

            $contactsPurged = 0;
            $documentsStamped = 0;
            $signatoryPurged = 0;

            if ($application instanceof B2bApplication) {
                $contactsPurged = $this->purgeApplicationContacts($application);
                $signatoryPurged = $this->purgeApplicationSignatory($application);
                $documentsStamped = $this->stampDocumentsForPurge($application, $offboarding, $now);
            }

            return [
                'application_contacts_purged' => $contactsPurged,
                'application_signatories_purged' => $signatoryPurged,
                'kyc_documents_stamped_for_purge' => $documentsStamped,
            ];
        });

        $offboarding->archive_summary = $summary;

        $this->transition($offboarding, OffboardingStatus::Completed, $actor, [
            'completed_at' => CarbonImmutable::now(),
        ], $summary + [
            // Said explicitly on the audit row, because "we kept the company
            // record" is the part somebody reading this later needs to know
            // was a decision rather than an omission.
            'legal_entity_retained' => true,
        ], action: 'b2b.offboarding_archived');

        return $offboarding;
    }

    /**
     * Call the whole thing off.
     *
     * Legal right up to the moment memberships start ending, and not
     * afterwards: "cancelling" a revocation would mean silently re-granting
     * access somebody deliberately removed, which is a different act needing a
     * different door.
     *
     * @throws OffboardingRefused
     */
    public function cancel(B2bOffboarding $offboarding, User $actor, string $reason): B2bOffboarding
    {
        $trimmed = trim($reason);

        if ($trimmed === '') {
            throw OffboardingRefused::cancellationNeedsReason();
        }

        $this->assertCanTransition($offboarding, OffboardingStatus::Cancelled);

        $this->transition($offboarding, OffboardingStatus::Cancelled, $actor, [
            'cancelled_at' => CarbonImmutable::now(),
            'cancelled_by' => (string) $actor->getKey(),
            'cancellation_reason' => $trimmed,
        ]);

        return $offboarding;
    }

    /**
     * The agreement in force for this organisation, latest version first.
     */
    public function activeAgreementFor(Organisation $organisation): ?B2bAgreement
    {
        return B2bAgreement::query()
            ->where('organisation_id', $organisation->getKey())
            ->where('status', AgreementStatus::Active->value)
            ->orderByDesc('version')
            ->first();
    }

    /**
     * @throws OffboardingRefused
     */
    private function assertCorporateCustomer(Organisation $organisation): void
    {
        $organisation->loadMissing('type');

        if ($organisation->type?->code !== 'corporate_customer') {
            throw OffboardingRefused::notCorporate();
        }
    }

    /**
     * @throws OffboardingRefused
     */
    private function assertCanTransition(B2bOffboarding $offboarding, OffboardingStatus $next): void
    {
        if (! $offboarding->status->canTransitionTo($next)) {
            throw OffboardingRefused::illegalTransition($offboarding->status, $next);
        }
    }

    /**
     * The spent passcode that proves the signatory was present.
     *
     * Four conditions, one refusal. See `AgreementService::provenSignatoryChallenge()`
     * for the full argument; the short version is that a caller holding
     * somebody else's challenge identifier must learn only that it did not
     * work.
     *
     * @throws OffboardingRefused
     */
    private function provenSignatoryChallenge(OffboardingSignoff $evidence, User $actor): OtpChallenge
    {
        $challenge = $evidence->otpChallengeId === null
            ? null
            : OtpChallenge::query()->whereKey($evidence->otpChallengeId)->first();

        $proved = $challenge instanceof OtpChallenge
            && $challenge->purpose === OtpPurpose::B2bSignatory
            && $challenge->status === OtpChallengeStatus::Verified
            && $challenge->user_id === (string) $actor->getKey();

        if (! $proved) {
            throw OffboardingRefused::signatoryRequired();
        }

        return $challenge;
    }

    /**
     * The destination a sign-off passcode is sent to.
     *
     * The agreement's signatory, through their login contact — the one row
     * that must agree with the login identity, so there is no question which
     * of somebody's addresses is meant.
     */
    private function signatoryContactFor(B2bOffboarding $offboarding): ?ContactPoint
    {
        $agreement = $offboarding->agreement;

        if (! $agreement instanceof B2bAgreement || $agreement->signatory_user_id === null) {
            return null;
        }

        $contact = ContactPoint::query()
            ->where('user_id', $agreement->signatory_user_id)
            ->where('is_login_identity', true)
            ->first();

        return $contact instanceof ContactPoint && $contact->isUsable() ? $contact : null;
    }

    private function applicationFor(B2bOffboarding $offboarding): ?B2bApplication
    {
        $agreement = $offboarding->agreement;

        if ($agreement instanceof B2bAgreement) {
            return $agreement->application;
        }

        return B2bApplication::query()
            ->where('provisioned_organisation_id', $offboarding->organisation_id)
            ->first();
    }

    /**
     * Null the humans a company named on its application; keep the row.
     *
     * The row survives with a note where the name was, because deleting it
     * would leave the application's own history — "we invited three people" —
     * pointing at nothing. What goes is every field that identifies a person.
     */
    private function purgeApplicationContacts(B2bApplication $application): int
    {
        $purged = 0;

        // `purged_at` is the idempotency guard rather than a marker string:
        // a re-run of a partially-failed archive skips what is already
        // stamped, without having to recognise a sentinel in a name column.
        $contacts = B2bApplicationContact::query()
            ->where('b2b_application_id', $application->getKey())
            ->whereNull('purged_at')
            ->get();

        foreach ($contacts as $contact) {
            $contact->name = self::PURGED_MARKER;
            $contact->title = null;
            $contact->email = null;
            $contact->phone = null;
            $contact->notes = 'Personal data purged on offboarding; the role this person held is retained.';
            $contact->purged_at = CarbonImmutable::now();
            $contact->save();
            $purged++;
        }

        return $purged;
    }

    /**
     * The signatory block on the application itself.
     */
    private function purgeApplicationSignatory(B2bApplication $application): int
    {
        if ($application->signatory_name === null && $application->signatory_email === null && $application->signatory_phone === null) {
            return 0;
        }

        // The legal identity fields — legal_name, registration numbers, tax
        // numbers, incorporation date — are deliberately untouched. A company
        // record has retention obligations the people named on it do not.
        $application->signatory_name = null;
        $application->signatory_title = null;
        $application->signatory_email = null;
        $application->signatory_phone = null;
        $application->save();

        return 1;
    }

    /**
     * Bring identity documents' retention deadline forward to now.
     *
     * Not deleted here. `KycDocumentService::purgeExpired()` deletes the object
     * before the row, one at a time, and is the only code path that knows that
     * ordering; duplicating it in an archive step would be a second deletion
     * policy that could drift from the first. What this does is make the
     * documents due.
     */
    private function stampDocumentsForPurge(B2bApplication $application, B2bOffboarding $offboarding, CarbonImmutable $now): int
    {
        return KycDocument::query()
            ->where(function (Builder $query) use ($application, $offboarding): void {
                $query->where('b2b_application_id', $application->getKey())
                    ->orWhere('organisation_id', $offboarding->organisation_id);
            })
            ->where('purge_after', '>', $now)
            ->update(['purge_after' => $now, 'updated_at' => now()]);
    }

    /**
     * @return list<string>
     */
    private function blockersOnRecord(B2bOffboarding $offboarding): array
    {
        $blockers = [];

        foreach ($offboarding->settlement_checks ?? [] as $check) {
            if ($check['outcome'] === SettlementOutcome::Outstanding->value) {
                $blockers[] = $check['check'];
            }
        }

        return $blockers;
    }

    private function settlementNote(SettlementAssessment $assessment): string
    {
        if ($assessment->isClear()) {
            return 'Every check answered clear or stated why it could not run: '
                .implode(', ', $assessment->unavailableReasons() === [] ? ['none unavailable'] : $assessment->unavailableReasons());
        }

        return 'Outstanding: '.implode(', ', $assessment->blockerNames());
    }

    /**
     * Write a transition, or refuse it.
     *
     * @param  array<string, mixed>  $changes
     * @param  array<string, scalar|list<scalar>|null>  $metadata
     *
     * @throws OffboardingRefused
     */
    private function transition(
        B2bOffboarding $offboarding,
        OffboardingStatus $next,
        User $actor,
        array $changes = [],
        array $metadata = [],
        ?string $action = null,
    ): void {
        $current = $offboarding->status;

        if (! $current->canTransitionTo($next)) {
            throw OffboardingRefused::illegalTransition($current, $next);
        }

        foreach ($changes as $column => $value) {
            $offboarding->setAttribute($column, $value);
        }

        $offboarding->status = $next;
        $offboarding->lock_version = $offboarding->lock_version + 1;
        $offboarding->save();

        $this->audit->record(
            $action ?? 'b2b.offboarding_'.$next->value,
            actorUserId: (string) $actor->getKey(),
            subjectType: 'b2b_offboarding',
            subjectId: (string) $offboarding->getKey(),
            metadata: $metadata + [
                'organisation_id' => $offboarding->organisation_id,
                'from_status' => $current->value,
                'to_status' => $next->value,
            ],
        );
    }

    private function defaultNoticeDays(): int
    {
        return (int) config('b2b.offboarding.default_notice_period_days', 30);
    }
}
