<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Closure\Enums\ClosureReasonCode;
use Healthy360\Customers\Closure\Enums\ClosureRequestStatus;
use Healthy360\Customers\Closure\Enums\ClosureScope;
use Healthy360\Customers\Closure\Exceptions\ClosureRefused;
use Healthy360\Customers\Closure\Jobs\FinaliseAccountClosure;
use Healthy360\Customers\Closure\Models\AccountClosureRequest;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Closure\Results\ClosureAcknowledgement;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Guest\Enums\SuppressionSource;
use Healthy360\Customers\Guest\Services\MarketingSuppressionRegistry;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Exceptions\ChannelUnavailable;
use Healthy360\Verification\Exceptions\OtpIssueRefused;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The closure journey: asked, proven, scheduled, finalised — or called off.
 *
 * ## The two scopes are one journey and one screen
 *
 * `marketing_opt_out` short-circuits: the marketing consents are withdrawn, a
 * suppression hash is written so the next import cannot silently re-add the
 * person, and the request is `completed` before the method returns. No
 * passcode, because there is nothing irreversible to protect — and demanding
 * one would be friction on the *reversible* choice, which is the surest way to
 * push somebody toward the irreversible one.
 *
 * `full` is an erasure and is therefore step-up proven.
 *
 * ## The proof is bound to the request, not to the session
 *
 * `verify()` accepts a challenge only if `account_closure_requests.
 * otp_challenge_id` is that challenge. A purpose-scoped step-up flag would be
 * enough to stop a `contact_verification` code unlocking a closure, and not
 * enough to stop *a* closure code finalising *another* closure — including one
 * support opened moments earlier that the customer never agreed to. The
 * database enforces the same rule (`account_closure_requests_proof_check`), so
 * a full closure that reached `verified` without a challenge cannot be stored
 * even if this method were bypassed.
 *
 * ## Support may open a closure and may never finish one
 *
 * `requestForCustomer()` takes an authorised platform actor and records them in
 * `initiated_by_user_id`, with `purpose_of_use = support` on every audit row.
 * The passcode still goes to the *customer's* verified destination, and
 * `verify()` refuses when the caller is the support actor. Staff who could both
 * start and finish an erasure would be staff who can erase anybody; the
 * customer's inbox is the second factor, and it is the only one they have.
 *
 * ## The blockers run twice, and the second time is the one that counts
 *
 * Once here, so a customer is told at the start what stands in the way; and
 * again inside `FinaliseAccountClosure`, because a subscription started during
 * the grace window is exactly what a cached verdict would miss.
 */
final class ClosureService
{
    /**
     * The marketing consents a `marketing_opt_out` withdraws.
     *
     * Named explicitly rather than derived from a `purpose LIKE 'marketing%'`
     * scan: the set a customer is agreeing to stop is a product decision, and
     * inferring it from a naming convention would mean a future
     * `marketing_preferences_analytics` definition silently joining the list.
     *
     * @var list<string>
     */
    public const array MARKETING_CONSENT_CODES = ['consent.marketing_email', 'consent.marketing_whatsapp'];

    public function __construct(
        private readonly ClosureBlockerRegistry $blockers,
        private readonly ClosureWindows $windows,
        private readonly OtpService $otp,
        private readonly ConsentLedger $consents,
        private readonly MarketingSuppressionRegistry $suppressions,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * A customer asking for themselves.
     *
     * @throws ClosureRefused
     */
    public function request(
        User $user,
        ClosureReasonCode $reason,
        ClosureScope $scope,
        ?string $note = null,
        ?OtpChannel $deliveryChannel = null,
        ?string $locale = null,
        ?string $requestIpHash = null,
    ): ClosureAcknowledgement {
        return $this->open($user, $reason, $scope, $note, null, $deliveryChannel, $locale, $requestIpHash);
    }

    /**
     * Support opening a closure on a customer's behalf.
     *
     * The actor is recorded and audited under `purpose_of_use = support`; the
     * passcode still goes to the customer. `$actor` is assumed already
     * authorised — the permission check is the HTTP layer's and is
     * integrator-2's to wire, because this module does not own the permission
     * vocabulary.
     *
     * @throws ClosureRefused
     */
    public function requestForCustomer(
        User $actor,
        User $user,
        ClosureReasonCode $reason,
        ClosureScope $scope,
        ?string $note = null,
        ?OtpChannel $deliveryChannel = null,
        ?string $locale = null,
    ): ClosureAcknowledgement {
        return $this->open($user, $reason, $scope, $note, $actor, $deliveryChannel, $locale, null);
    }

    /**
     * Prove a closure and move it to `scheduled`.
     *
     * @param  User|null  $actor  whoever is entering the code; null means the
     *                            customer themselves. A support actor is refused.
     *
     * @throws ClosureRefused
     */
    public function verify(AccountClosureRequest $request, string $code, ?User $actor = null): ClosureAcknowledgement
    {
        if ($request->status !== ClosureRequestStatus::Requested) {
            throw ClosureRefused::notAwaitingVerification();
        }

        if ($actor instanceof User && (string) $actor->getKey() !== (string) $request->user_id) {
            throw ClosureRefused::supportCannotSelfVerify();
        }

        // A support-initiated closure must name who is entering the code, and
        // the check above then proves it is the customer. Without this, an
        // omitted `$actor` — a controller that forgot to pass the authenticated
        // user — would fall through the guard silently, which is the one place
        // a missing argument turns into staff finalising somebody else's
        // erasure. A customer's own closure needs no such statement: the
        // request and the actor are the same person by construction.
        if ($request->isSupportInitiated() && ! $actor instanceof User) {
            throw ClosureRefused::supportCannotSelfVerify();
        }

        $challenge = $request->challenge;

        if (! $challenge instanceof OtpChallenge || ! $challenge->isLive()) {
            throw ClosureRefused::verificationFailed();
        }

        try {
            $result = $this->otp->verify($challenge, $code);
        } catch (OtpIssueRefused) {
            // Locked out. Collapsed into the ordinary refusal: a distinct
            // answer here is a fact about a challenge that exists.
            throw ClosureRefused::verificationFailed();
        }

        if (! $result->verified) {
            throw ClosureRefused::verificationFailed();
        }

        $user = $request->user;

        if (! $user instanceof User) {
            // The identity behind the request is gone. Only a hard delete of
            // the `users` row can produce this, which closure never does — so
            // it means somebody else did, and there is nothing left to close.
            throw ClosureRefused::notAwaitingVerification();
        }

        $verdicts = $this->blockers->evaluate($user, $request->customerAccount);

        $request->forceFill([
            'status' => ClosureRequestStatus::Verified,
            'verified_at' => now(),
            'blockers' => $this->blockers->toArray($verdicts),
        ])->save();

        $this->recordEvent('account.closure_verified', $request, $verdicts);

        if ($this->blockers->isBlocked($verdicts)) {
            // Proven, and still not going anywhere. The request stays
            // `verified` rather than being cancelled: the person proved who
            // they were, and making them do it again after their last order
            // arrives would be punishing them for our scheduling.
            return $this->acknowledge($request, $verdicts, verificationRequired: false);
        }

        return $this->schedule($request, $verdicts);
    }

    /**
     * Move a verified request into the grace window and queue its finalisation.
     *
     * With the default zero-length window `scheduled_for` is now and the job
     * runs immediately; with a positive one the job is delayed to the moment
     * the window closes, and `ProcessScheduledClosures` is the safety net for
     * a delayed job the queue lost.
     *
     * @param  list<BlockerVerdict>  $verdicts
     */
    public function schedule(AccountClosureRequest $request, array $verdicts): ClosureAcknowledgement
    {
        $dueAt = $this->windows->dueAt(CarbonImmutable::now());

        $request->forceFill([
            'status' => ClosureRequestStatus::Scheduled,
            'scheduled_for' => $dueAt,
        ])->save();

        $this->recordEvent('account.closure_scheduled', $request, $verdicts);

        FinaliseAccountClosure::dispatch((string) $request->getKey())->delay($dueAt);

        return $this->acknowledge($request->refresh(), $verdicts, verificationRequired: false);
    }

    /**
     * "Actually, no."
     *
     * Permitted up to and including `scheduled`. After finalisation there is
     * nothing to cancel, and offering it would be an undo that does not exist.
     *
     * @throws ClosureRefused
     */
    public function cancel(AccountClosureRequest $request, string $because = 'customer_cancelled'): AccountClosureRequest
    {
        if (! $request->status->isCancellable()) {
            throw ClosureRefused::notCancellable();
        }

        $request->forceFill([
            'status' => ClosureRequestStatus::Cancelled,
            'cancelled_at' => now(),
            'cancelled_because' => $because,
        ])->save();

        $this->recordEvent('account.closure_cancelled', $request, []);

        return $request;
    }

    /**
     * Re-evaluate without changing anything.
     *
     * What a closure screen calls before it renders, and what the finalisation
     * job calls before it acts.
     *
     * @return list<BlockerVerdict>
     */
    public function evaluateBlockers(User $user, ?CustomerAccount $account): array
    {
        return $this->blockers->evaluate($user, $account);
    }

    /**
     * The live request for this identity, if there is one.
     */
    public function liveRequestFor(User $user): ?AccountClosureRequest
    {
        $request = AccountClosureRequest::query()
            ->where('user_id', $user->getKey())
            ->whereIn('status', [
                ClosureRequestStatus::Requested->value,
                ClosureRequestStatus::Verified->value,
                ClosureRequestStatus::Scheduled->value,
            ])
            ->first();

        return $request instanceof AccountClosureRequest ? $request : null;
    }

    /**
     * The shared body of both request paths.
     *
     * @throws ClosureRefused
     */
    private function open(
        User $user,
        ClosureReasonCode $reason,
        ClosureScope $scope,
        ?string $note,
        ?User $actor,
        ?OtpChannel $deliveryChannel,
        ?string $locale,
        ?string $requestIpHash,
    ): ClosureAcknowledgement {
        if ($this->liveRequestFor($user) instanceof AccountClosureRequest) {
            throw ClosureRefused::alreadyInFlight();
        }

        $account = $this->accountFor($user);
        $verdicts = $scope->consultsBlockers()
            ? $this->blockers->evaluate($user, $account)
            : [];

        $request = DB::transaction(fn (): AccountClosureRequest => AccountClosureRequest::query()->create([
            'user_id' => $user->getKey(),
            'customer_account_id' => $account?->getKey(),
            'reason_code' => $reason->value,
            'reason_note' => $note,
            'scope' => $scope->value,
            'status' => ClosureRequestStatus::Requested->value,
            'initiated_by_user_id' => $actor?->getKey(),
            'requested_at' => now(),
            'blockers' => $this->blockers->toArray($verdicts),
        ]));

        $this->recordEvent('account.closure_requested', $request, $verdicts);

        if ($scope === ClosureScope::MarketingOptOut) {
            return $this->completeOptOut($request, $user, $account);
        }

        if ($this->blockers->isBlocked($verdicts)) {
            // No passcode is sent for a request that cannot proceed. Issuing
            // one would be asking somebody to prove their identity for an act
            // we have already decided not to perform.
            return $this->acknowledge($request, $verdicts, verificationRequired: true);
        }

        return $this->issueProof($request, $user, $account, $verdicts, $deliveryChannel, $locale, $requestIpHash);
    }

    /**
     * The short-circuit: stop the marketing, keep everything else.
     *
     * Completed inside the same call, because the customer's expectation is
     * that "stop emailing me" has taken effect by the time the page reloads —
     * and because there is nothing here that a delay could protect.
     *
     * The suppression hash is the part that is easy to leave out and is the
     * part that makes the opt-out durable: a withdrawn consent grant is a row
     * on this platform, and the next list import from anywhere else would not
     * consult it.
     */
    private function completeOptOut(AccountClosureRequest $request, User $user, ?CustomerAccount $account): ClosureAcknowledgement
    {
        $withdrawn = $this->consents->withdraw($user, self::MARKETING_CONSENT_CODES, 'account_closure');

        $suppressed = 0;

        foreach ($this->contactsFor($user, $account) as $contact) {
            $this->suppressions->suppressContact($contact, SuppressionSource::OptOut);
            $suppressed++;
        }

        $request->forceFill([
            'status' => ClosureRequestStatus::Completed,
            'completed_at' => now(),
        ])->save();

        $this->audit->record(
            'account.closure_completed',
            actorUserId: $request->initiated_by_user_id,
            subjectType: 'user',
            subjectId: (string) $request->user_id,
            metadata: [
                'closure_request' => (string) $request->getKey(),
                'scope' => $request->scope->value,
                'closure_reason' => $request->reason_code->value,
                'consents_withdrawn' => $withdrawn,
                'suppressions_written' => $suppressed,
            ],
            purposeOfUse: $this->purposeFor($request),
        );

        return $this->acknowledge($request, [], verificationRequired: false);
    }

    /**
     * Send the passcode and bind it to this request.
     *
     * @param  list<BlockerVerdict>  $verdicts
     *
     * @throws ClosureRefused
     */
    private function issueProof(
        AccountClosureRequest $request,
        User $user,
        ?CustomerAccount $account,
        array $verdicts,
        ?OtpChannel $deliveryChannel,
        ?string $locale,
        ?string $requestIpHash,
    ): ClosureAcknowledgement {
        $contact = $this->proofDestinationFor($user, $account);

        if (! $contact instanceof ContactPoint) {
            throw ClosureRefused::noVerifiableContact();
        }

        try {
            $result = $this->otp->issue(
                contact: $contact,
                purpose: OtpPurpose::ClosureStepUp,
                channel: $deliveryChannel,
                locale: $locale,
                requestIpHash: $requestIpHash,
            );
        } catch (OtpIssueRefused|ChannelUnavailable) {
            // Unlike the guest journey, this refusal is *not* swallowed. There
            // is no enumeration risk here — the caller is already
            // authenticated as the account holder — and silently returning
            // "check your email" for a code that was never sent would strand
            // somebody on a screen waiting for a message that is not coming.
            throw ClosureRefused::verificationFailed();
        }

        $request->forceFill(['otp_challenge_id' => $result->challenge->getKey()])->save();

        return $this->acknowledge(
            $request,
            $verdicts,
            verificationRequired: true,
            // Server-authored by the OTP service. Masking it again here would
            // be a second implementation of a rule that already has one.
            destinationMasked: $result->destinationMasked,
            expiresInSeconds: max(0, (int) round(CarbonImmutable::now()->diffInSeconds($result->expiresAt))),
        );
    }

    /**
     * Where the proof is sent.
     *
     * The login identity first, then any verified destination. Deliberately
     * **not** the most recently added contact: an attacker holding a borrowed
     * session whose first move is to add their own address would otherwise
     * receive the code themselves, which turns the step-up into a formality.
     */
    private function proofDestinationFor(User $user, ?CustomerAccount $account): ?ContactPoint
    {
        $login = $user->loginContact;

        if ($login instanceof ContactPoint && $login->isVerified()) {
            return $login;
        }

        foreach ($this->contactsFor($user, $account) as $contact) {
            if ($contact->isVerified()) {
                return $contact;
            }
        }

        return null;
    }

    /**
     * Every live destination this identity can be reached on.
     *
     * A Collection rather than a list: both callers iterate it, and the only
     * reason to flatten it would be to satisfy a type annotation.
     *
     * @return Collection<int, ContactPoint>
     */
    private function contactsFor(User $user, ?CustomerAccount $account): Collection
    {
        return ContactPoint::query()
            ->where(function ($query) use ($user, $account): void {
                $query->where('user_id', $user->getKey());

                if ($account instanceof CustomerAccount) {
                    $query->orWhere('customer_account_id', $account->getKey());
                }
            })
            ->whereNull('retired_at')
            ->orderBy('created_at')
            ->get();
    }

    /**
     * The consumer account this identity holds, if any.
     *
     * `b2c` only. A corporate account belongs to the company, outlives the
     * individual who opened it, and is B2's to offboard — anonymising it
     * because one buyer left would close a business relationship nobody ended.
     */
    private function accountFor(User $user): ?CustomerAccount
    {
        $account = CustomerAccount::query()
            ->where('user_id', $user->getKey())
            ->where('account_type', CustomerAccountType::B2c)
            ->first();

        return $account instanceof CustomerAccount ? $account : null;
    }

    /**
     * @param  list<BlockerVerdict>  $verdicts
     */
    private function acknowledge(
        AccountClosureRequest $request,
        array $verdicts,
        bool $verificationRequired,
        ?string $destinationMasked = null,
        ?int $expiresInSeconds = null,
    ): ClosureAcknowledgement {
        return ClosureAcknowledgement::for(
            $request,
            $verdicts,
            $verificationRequired,
            $destinationMasked,
            $expiresInSeconds,
        );
    }

    /**
     * One audit shape for every stage of the journey.
     *
     * **`closure_reason`, not `reason_code`.** `AuditRecorder` blanks any
     * metadata key containing `code`, so the obvious name would store the
     * string `[redacted]` in place of the one field the whole "why do people
     * leave" question is built on. The convention is the module's (never end a
     * metadata key in `_code`) and this is the call site where forgetting it
     * would be silent.
     *
     * The blocker codes travel as a flat list of strings for the same reason:
     * the redactor walks top-level keys, and `blockers` is safe where
     * `blocker_codes` would not be.
     *
     * `reason_note` is never included. It is the one free-text field on the
     * request and putting it here would move a person's own words into a table
     * that survives their erasure.
     *
     * @param  list<BlockerVerdict>  $verdicts
     */
    private function recordEvent(string $action, AccountClosureRequest $request, array $verdicts): void
    {
        $blocking = array_values(array_map(
            static fn (BlockerVerdict $verdict): string => $verdict->code,
            array_filter($verdicts, static fn (BlockerVerdict $verdict): bool => $verdict->stopsClosure()),
        ));

        $this->audit->record(
            $action,
            actorUserId: $request->initiated_by_user_id,
            subjectType: 'user',
            subjectId: (string) $request->user_id,
            metadata: [
                'closure_request' => (string) $request->getKey(),
                'scope' => $request->scope->value,
                'closure_reason' => $request->reason_code->value,
                'support_initiated' => $request->isSupportInitiated(),
                'blockers' => $blocking,
            ],
            purposeOfUse: $this->purposeFor($request),
        );
    }

    /**
     * Support-initiated closures are audited as support activity; a customer's
     * own closure is self-service. The distinction is the whole reason the
     * column on `audit_logs` exists.
     */
    private function purposeFor(AccountClosureRequest $request): string
    {
        return $request->isSupportInitiated()
            ? PurposeOfUse::Support->value
            : PurposeOfUse::SelfService->value;
    }
}
