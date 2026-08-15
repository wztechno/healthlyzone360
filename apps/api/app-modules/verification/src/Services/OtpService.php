<?php

declare(strict_types=1);

namespace Healthy360\Verification\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactValueNormaliser;
use Healthy360\Verification\Channels\OtpChannelRegistry;
use Healthy360\Verification\Enums\OtpChallengeStatus;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Exceptions\ChannelUnavailable;
use Healthy360\Verification\Exceptions\OtpIssueRefused;
use Healthy360\Verification\Jobs\SendOtpMessage;
use Healthy360\Verification\Messages\OtpDispatch;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Results\OtpChallengeResult;
use Healthy360\Verification\Results\OtpVerificationResult;
use Illuminate\Support\Facades\DB;

/**
 * The OTP framework's single entry point.
 *
 * Every security property of this design lives in this class, so they are
 * stated together rather than discovered one at a time:
 *
 * **The code exists in memory and nowhere else.** It is generated, hashed into
 * the row, and handed to a queued job that declares `ShouldBeEncrypted`. It is
 * never logged, never audited, never returned — except through `debugCode`,
 * which requires both a configuration flag and a local/testing environment.
 *
 * **One live challenge per contact per purpose.** Issuing supersedes any
 * predecessor inside the same transaction, and a partial unique index makes
 * that structural. Two live challenges would make the attempt counter
 * meaningless: exhaust one, read the other.
 *
 * **Attempts are counted before the code is compared**, under `SELECT … FOR
 * UPDATE`. Comparing first and counting after gives two concurrent requests
 * the same allowance, and gives a crash between the two steps a free attempt.
 * The row is the lock and the ledger at once.
 *
 * **A lockout sits above the counter.** Three wrong codes burn a challenge;
 * without something that outlives the challenge, the next request simply buys
 * three more. `OtpLockout` counts failures per contact point across every
 * channel, which is the only key an attacker cannot rotate.
 *
 * **Nothing here says whether an account exists.** The service takes a contact
 * point that the caller has already resolved; it never looks one up from a
 * user-supplied address, so it cannot become an enumeration oracle. Refusals
 * are shaped the same way for a locked-out contact and a finished challenge.
 */
final class OtpService
{
    public function __construct(
        private readonly OtpCodeHasher $hasher,
        private readonly OtpLockout $lockout,
        private readonly OtpChannelRegistry $channels,
        private readonly ContactValueNormaliser $normaliser,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * Issue a passcode and send it.
     *
     * @throws OtpIssueRefused
     * @throws ChannelUnavailable
     */
    public function issue(
        ContactPoint $contact,
        OtpPurpose $purpose,
        ?OtpChannel $channel = null,
        ?string $locale = null,
        ?string $requestIpHash = null,
    ): OtpChallengeResult {
        ['result' => $result, 'code' => $code, 'challenge' => $challenge] = $this->createChallenge($contact, $purpose, $channel, $requestIpHash);

        $this->dispatchMessage($challenge, $contact, $code, $locale);

        return $result;
    }

    /**
     * Issue a passcode whose message the caller sends itself.
     *
     * Exactly one caller: the email verification notification, which carries
     * the signed link and the code in one message (D-036). A second message
     * would be two codes for one act.
     *
     * The plaintext is returned because it exists nowhere else — only its
     * digest is stored — so a caller that means to deliver it must be handed
     * it at the moment of issue or never. The method is named for that
     * responsibility rather than hidden behind a boolean flag, so a reader
     * grepping for "who else sees a plaintext code" finds one answer.
     *
     * @return array{result: OtpChallengeResult, code: string}
     *
     * @throws OtpIssueRefused
     * @throws ChannelUnavailable
     */
    public function issueForInlineDelivery(
        ContactPoint $contact,
        OtpPurpose $purpose,
        ?OtpChannel $channel = null,
        ?string $requestIpHash = null,
    ): array {
        ['result' => $result, 'code' => $code] = $this->createChallenge($contact, $purpose, $channel, $requestIpHash);

        return ['result' => $result, 'code' => $code];
    }

    /**
     * The shared body of both issue paths: validate, supersede, insert, audit.
     *
     * @return array{result: OtpChallengeResult, code: string, challenge: OtpChallenge}
     *
     * @throws OtpIssueRefused
     * @throws ChannelUnavailable
     */
    private function createChallenge(
        ContactPoint $contact,
        OtpPurpose $purpose,
        ?OtpChannel $channel,
        ?string $requestIpHash,
    ): array {
        if (! $purpose->isIssuable()) {
            throw OtpIssueRefused::purposeNotIssuable($purpose->value);
        }

        if (! $contact->isUsable()) {
            throw OtpIssueRefused::contactUnusable();
        }

        $lockedUntil = $this->lockout->lockedUntil((string) $contact->getKey());

        if ($lockedUntil !== null) {
            throw OtpIssueRefused::lockedOut($lockedUntil);
        }

        $channel ??= $this->channels->defaultFor($contact->channel);

        if ($channel === null) {
            throw ChannelUnavailable::forContact($contact->channel);
        }

        if ($channel->contactChannel() !== $contact->channel) {
            throw ChannelUnavailable::for($channel);
        }

        $driver = $this->channels->driverFor($channel);

        $code = $this->hasher->generate();
        $now = now();

        $challenge = DB::transaction(function () use ($contact, $purpose, $channel, $code, $now, $requestIpHash): OtpChallenge {
            // Supersede first, inside the transaction: the unique index
            // refuses a second pending row, so this is not a courtesy — it is
            // what makes the insert possible at all.
            $this->supersede($contact, $purpose);

            return OtpChallenge::query()->create([
                'contact_point_id' => $contact->getKey(),
                'user_id' => $contact->user_id,
                'customer_account_id' => $contact->customer_account_id,
                'purpose' => $purpose,
                'channel' => $channel,
                'destination_masked' => $this->normaliser->mask($contact->channel, $contact->value_normalised),
                'code_hash' => $this->hasher->hash($code),
                'status' => OtpChallengeStatus::Pending,
                'attempts' => 0,
                'max_attempts' => $this->maxAttempts(),
                'resend_count' => 0,
                'max_resends' => $this->maxResends(),
                'expires_at' => $now->addSeconds($this->expirySeconds()),
                'last_sent_at' => $now,
                'resend_available_at' => $now->addSeconds($this->cooldownSeconds()),
                'request_ip_hash' => $requestIpHash,
            ]);
        });

        // Audited without the code and without a metadata key containing it.
        // `*_code` keys are redacted by substring match (OQ-036), so an event
        // that used one would record that a passcode was issued and refuse to
        // say for which channel.
        $this->audit->record(
            'verification.otp_issued',
            actorUserId: $contact->user_id,
            subjectType: 'contact_point',
            subjectId: (string) $contact->getKey(),
            metadata: [
                'otp_challenge_id' => (string) $challenge->getKey(),
                'purpose' => $purpose->value,
                'delivery_channel' => $channel->value,
                'simulated' => $driver->isSimulated(),
            ],
        );

        return [
            'result' => $this->result($challenge, $contact, $code),
            'code' => $code,
            'challenge' => $challenge,
        ];
    }

    /**
     * Send the same challenge again.
     *
     * The code is regenerated rather than resent, because the plaintext is not
     * kept: only its digest is stored, which is the property that makes a
     * database dump useless. A resend is therefore a new code on the same
     * challenge — the attempt counter and the expiry window carry over, so a
     * caller cannot reset either by pressing the button.
     *
     * @throws OtpIssueRefused
     * @throws ChannelUnavailable
     */
    public function resend(OtpChallenge $challenge, ?OtpChannel $channel = null, ?string $locale = null): OtpChallengeResult
    {
        if (! $challenge->isLive()) {
            throw OtpIssueRefused::notLive();
        }

        $lockedUntil = $this->lockout->lockedUntil($challenge->contact_point_id);

        if ($lockedUntil !== null) {
            throw OtpIssueRefused::lockedOut($lockedUntil);
        }

        if ($challenge->resendsRemaining() < 1) {
            throw OtpIssueRefused::resendLimit();
        }

        $availableAt = $challenge->resend_available_at;

        if ($availableAt instanceof CarbonImmutable && $availableAt->isFuture()) {
            throw OtpIssueRefused::cooldown($availableAt);
        }

        $contact = $challenge->contactPoint()->first();

        if (! $contact instanceof ContactPoint || ! $contact->isUsable()) {
            throw OtpIssueRefused::contactUnusable();
        }

        $channel ??= $challenge->channel;

        if ($channel->contactChannel() !== $contact->channel) {
            throw ChannelUnavailable::for($channel);
        }

        $driver = $this->channels->driverFor($channel);
        $code = $this->hasher->generate();
        $now = now();

        $challenge->forceFill([
            'code_hash' => $this->hasher->hash($code),
            'channel' => $channel,
            'resend_count' => $challenge->resend_count + 1,
            'last_sent_at' => $now,
            'resend_available_at' => $now->addSeconds($this->cooldownSeconds()),
        ])->save();

        $this->audit->record(
            'verification.otp_resent',
            actorUserId: $challenge->user_id,
            subjectType: 'contact_point',
            subjectId: $challenge->contact_point_id,
            metadata: [
                'otp_challenge_id' => (string) $challenge->getKey(),
                'purpose' => $challenge->purpose->value,
                'delivery_channel' => $channel->value,
                'resend_count' => $challenge->resend_count,
                'simulated' => $driver->isSimulated(),
            ],
        );

        $this->dispatchMessage($challenge, $contact, $code, $locale);

        return $this->result($challenge->refresh(), $contact, $code);
    }

    /**
     * Check a code against a challenge.
     *
     * The whole method runs inside a transaction holding a row lock, and the
     * attempt is counted *before* the comparison. Two concurrent requests
     * therefore see attempts 1 and 2 rather than both seeing 0, and a process
     * killed between counting and answering has spent the attempt rather than
     * granting a free one.
     *
     * @throws OtpIssueRefused when the challenge cannot be attempted at all
     */
    public function verify(OtpChallenge $challenge, string $code): OtpVerificationResult
    {
        $contactPointId = $challenge->contact_point_id;

        $lockedUntil = $this->lockout->lockedUntil($contactPointId);

        if ($lockedUntil !== null) {
            throw OtpIssueRefused::lockedOut($lockedUntil);
        }

        /** @var array{result: OtpVerificationResult, failed: bool} $outcome */
        $outcome = DB::transaction(function () use ($challenge, $code): array {
            $locked = OtpChallenge::query()->whereKey($challenge->getKey())->lockForUpdate()->first();

            if (! $locked instanceof OtpChallenge) {
                return ['result' => OtpVerificationResult::failure($challenge, OtpVerificationResult::REASON_NOT_LIVE), 'failed' => false];
            }

            if (! $locked->status->isLive()) {
                return ['result' => OtpVerificationResult::failure($locked, OtpVerificationResult::REASON_NOT_LIVE), 'failed' => false];
            }

            if ($locked->expires_at->isPast()) {
                $this->finish($locked, OtpChallengeStatus::Expired);

                return ['result' => OtpVerificationResult::failure($locked, OtpVerificationResult::REASON_EXPIRED), 'failed' => false];
            }

            // Counted first. See the class comment.
            $locked->forceFill(['attempts' => $locked->attempts + 1])->save();

            if ($this->hasher->matches($code, $locked->code_hash)) {
                $locked->forceFill([
                    'status' => OtpChallengeStatus::Verified,
                    'verified_at' => now(),
                    'finished_at' => now(),
                ])->save();

                return ['result' => OtpVerificationResult::success($locked), 'failed' => false];
            }

            if ($locked->attemptsRemaining() < 1) {
                $this->finish($locked, OtpChallengeStatus::Failed);

                return ['result' => OtpVerificationResult::failure($locked, OtpVerificationResult::REASON_ATTEMPTS_EXHAUSTED), 'failed' => true];
            }

            return ['result' => OtpVerificationResult::failure($locked, OtpVerificationResult::REASON_INVALID_CODE), 'failed' => true];
        });

        $result = $outcome['result'];

        if ($result->verified) {
            $this->lockout->clear($contactPointId);

            $this->audit->record(
                'verification.otp_verified',
                actorUserId: $result->challenge->user_id,
                subjectType: 'contact_point',
                subjectId: $contactPointId,
                metadata: [
                    'otp_challenge_id' => (string) $result->challenge->getKey(),
                    'purpose' => $result->challenge->purpose->value,
                    'delivery_channel' => $result->challenge->channel->value,
                ],
            );

            return $result;
        }

        if (! $outcome['failed']) {
            return $result;
        }

        $lockedUntil = $this->lockout->recordFailure($contactPointId);

        $this->audit->record(
            'verification.otp_failed',
            actorUserId: $result->challenge->user_id,
            subjectType: 'contact_point',
            subjectId: $contactPointId,
            metadata: [
                'otp_challenge_id' => (string) $result->challenge->getKey(),
                'purpose' => $result->challenge->purpose->value,
                'reason' => $result->reason,
                'attempts_remaining' => $result->attemptsRemaining,
                'locked_out' => $lockedUntil !== null,
            ],
        );

        return $lockedUntil === null
            ? $result
            : OtpVerificationResult::failure($result->challenge, OtpVerificationResult::REASON_LOCKED_OUT, $lockedUntil);
    }

    /**
     * Close any live challenge for this destination and purpose.
     *
     * Called when the thing being proven stops needing proof — a contact
     * removed, an email changed, a journey abandoned — so a code already in
     * somebody's inbox stops working the moment it stops being relevant.
     *
     * @return int how many were closed
     */
    public function invalidateActive(ContactPoint $contact, ?OtpPurpose $purpose = null): int
    {
        return OtpChallenge::query()
            ->where('contact_point_id', $contact->getKey())
            ->when($purpose !== null, fn ($query) => $query->where('purpose', $purpose))
            ->where('status', OtpChallengeStatus::Pending)
            ->update([
                'status' => OtpChallengeStatus::Superseded->value,
                'finished_at' => now(),
                'updated_at' => now(),
            ]);
    }

    /**
     * The live challenge for this destination and purpose, if there is one.
     *
     * Expiry is a moment rather than an event, so a row can be `pending` and
     * past its window; this returns null for those and leaves the transition
     * to the next verify or to the purge job.
     */
    public function liveChallengeFor(ContactPoint $contact, OtpPurpose $purpose): ?OtpChallenge
    {
        $challenge = OtpChallenge::query()
            ->where('contact_point_id', $contact->getKey())
            ->where('purpose', $purpose)
            ->where('status', OtpChallengeStatus::Pending)
            ->first();

        return $challenge instanceof OtpChallenge && $challenge->isLive() ? $challenge : null;
    }

    /**
     * The channels a client may be offered for this destination.
     *
     * @return list<array{channel: string, simulated: bool}>
     */
    public function availableChannels(ContactPoint $contact): array
    {
        return $this->channels->availableFor($contact->channel);
    }

    /**
     * Whether plaintext codes may be handed back to a caller.
     *
     * Two conditions, both required, and the environment one is not
     * configurable: a production `.env` that sets `OTP_EXPOSE_CODES=true`
     * still exposes nothing. That is the difference between a flag and a
     * guarantee.
     */
    public function exposesCodes(): bool
    {
        return (bool) config('verification.otp.expose_codes', false)
            && app()->environment(['local', 'testing']);
    }

    private function supersede(ContactPoint $contact, OtpPurpose $purpose): void
    {
        OtpChallenge::query()
            ->where('contact_point_id', $contact->getKey())
            ->where('purpose', $purpose)
            ->where('status', OtpChallengeStatus::Pending)
            ->update([
                'status' => OtpChallengeStatus::Superseded->value,
                'finished_at' => now(),
                'updated_at' => now(),
            ]);
    }

    private function finish(OtpChallenge $challenge, OtpChallengeStatus $status): void
    {
        $challenge->forceFill([
            'status' => $status,
            'finished_at' => now(),
        ])->save();
    }

    private function dispatchMessage(OtpChallenge $challenge, ContactPoint $contact, string $code, ?string $locale): void
    {
        SendOtpMessage::dispatch($this->dispatchFor($challenge, $contact, $code, $locale));
    }

    /**
     * The payload a driver receives. Public so the email-verification path can
     * build the same message without issuing a second delivery (D-036).
     */
    public function dispatchFor(OtpChallenge $challenge, ContactPoint $contact, string $code, ?string $locale = null): OtpDispatch
    {
        $resolved = $locale ?? $this->localeFor($contact);

        return new OtpDispatch(
            challengeId: (string) $challenge->getKey(),
            channel: $challenge->channel,
            purpose: $challenge->purpose,
            destination: $contact->value_normalised,
            destinationMasked: $challenge->destination_masked,
            code: $code,
            expiresInSeconds: $this->expirySeconds(),
            locale: $resolved,
            direction: LocaleDirection::for($resolved),
            recipientName: $this->recipientNameFor($contact),
        );
    }

    private function result(OtpChallenge $challenge, ContactPoint $contact, string $code): OtpChallengeResult
    {
        $driver = $this->channels->driverFor($challenge->channel);

        /** @var CarbonImmutable $resendAvailableAt */
        $resendAvailableAt = $challenge->resend_available_at ?? $challenge->expires_at;

        return new OtpChallengeResult(
            challenge: $challenge,
            destinationMasked: $challenge->destination_masked,
            expiresAt: $challenge->expires_at,
            resendAvailableAt: $resendAvailableAt,
            resendCooldownSeconds: $this->cooldownSeconds(),
            attemptsRemaining: $challenge->attemptsRemaining(),
            resendsRemaining: $challenge->resendsRemaining(),
            availableChannels: $this->channels->availableFor($contact->channel),
            simulated: $driver->isSimulated(),
            debugCode: $this->exposesCodes() ? $code : null,
        );
    }

    /**
     * The language the message is written in: the account holder's stated
     * preference, or the application default.
     *
     * Read from the profile rather than from `Accept-Language`, because a
     * passcode may be sent by a job with no request behind it, and a person's
     * language is a property of the person rather than of the browser that
     * happened to trigger the send.
     */
    private function localeFor(ContactPoint $contact): string
    {
        $user = $contact->user_id === null ? null : User::query()->whereKey($contact->user_id)->first();
        $preferred = $user?->profile?->preferred_language_code;

        return is_string($preferred) && $preferred !== '' ? $preferred : (string) config('app.locale', 'en');
    }

    private function recipientNameFor(ContactPoint $contact): ?string
    {
        if ($contact->user_id === null) {
            return null;
        }

        $profile = User::query()->whereKey($contact->user_id)->first()?->profile;

        return $profile?->given_name;
    }

    private function expirySeconds(): int
    {
        return max(30, (int) config('verification.otp.expires_after_seconds', 300));
    }

    private function cooldownSeconds(): int
    {
        return max(0, (int) config('verification.otp.resend_cooldown_seconds', 45));
    }

    private function maxAttempts(): int
    {
        return max(1, (int) config('verification.otp.max_attempts', 3));
    }

    private function maxResends(): int
    {
        return max(0, (int) config('verification.otp.max_resends', 3));
    }
}
