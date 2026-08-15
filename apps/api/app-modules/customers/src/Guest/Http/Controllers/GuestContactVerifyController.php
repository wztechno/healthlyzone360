<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Controllers;

use Healthy360\Customers\Guest\Http\Middleware\ResolveGuestSession;
use Healthy360\Customers\Guest\Http\Requests\VerifyGuestContactRequest;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Presenters\GuestSessionPresenter;
use Healthy360\Customers\Guest\Services\GuestSessionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Results\OtpVerificationResult;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/guest/contacts/verify — `guest.session`.
 *
 * The passcode comes back, and if it holds the session is promoted to
 * `place_order`. The one act that raises a guest's grade, and the reason
 * `guest_sessions_grade_proof_check` exists: a bug that skipped this endpoint
 * cannot write the higher grade at all.
 *
 * ## The challenge is resolved by the account, not by the identifier
 *
 * A `challenge_id` names a row; it does not name a row the caller may answer.
 * The lookup is scoped to *this session's* customer account and to
 * `guest_order`, and everything outside that scope — an identifier that never
 * existed, one belonging to another guest, one issued for a deletion — gets the
 * same `404`. Distinguishing them would let a caller holding one live token
 * probe for other people's challenges, and "that challenge exists but is not
 * yours" is a sentence that only helps somebody it should not help.
 *
 * ## The one mapping this layer owns
 *
 * `OtpVerificationResult` is a value object, not a throwable — deliberately, so
 * that a mistyped code stays an ordinary event carrying "two tries left" rather
 * than an exception that loses it. Something has to turn it into HTTP, and this
 * is the only honest place: the domain declined to guess at a wire vocabulary,
 * and the wire vocabulary lives in Support.
 *
 *  * `otp.invalid_code` → `422 otp.invalid`, with `attempts_remaining`, because
 *    a screen that cannot show how many tries are left has to guess when to
 *    stop asking.
 *  * `otp.expired` and `otp.challenge_not_live` → `422 otp.expired`. One code
 *    for both: the remedy is identical — ask for a new one — and a caller who
 *    could tell "timed out" from "superseded" would learn how many challenges
 *    are in flight against a destination.
 *  * `otp.attempts_exhausted` → `429 otp.attempts_exceeded`. A limit reached
 *    rather than a value rejected: no further attempt against this challenge
 *    can succeed.
 *  * `otp.locked_out` → `429 otp.locked`, with `locked_until`, because a fresh
 *    challenge will not help either and a client that offered "resend" would
 *    be lying.
 *
 * A lockout raised as `OtpIssueRefused` by `OtpService` is *not* caught: it
 * renders itself. Only the value object is mapped.
 *
 * ## What comes back
 *
 * The same shape `GET /guest/session` serves. A client that has just been
 * promoted needs exactly what a client resuming needs — the new grade and the
 * account behind it — and returning a different shape for the same facts would
 * mean two renderers for one screen.
 */
final class GuestContactVerifyController
{
    public function __construct(
        private readonly GuestSessionService $sessions,
        private readonly GuestSessionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(VerifyGuestContactRequest $request): JsonResponse
    {
        /** @var GuestSession $session */
        $session = $request->attributes->get(ResolveGuestSession::ATTRIBUTE_SESSION);

        $payload = $request->payload();

        $challenge = OtpChallenge::query()
            ->whereKey($payload['challenge_id'])
            ->where('customer_account_id', $session->customer_account_id)
            ->where('purpose', OtpPurpose::GuestOrder)
            ->first();

        if (! $challenge instanceof OtpChallenge) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'No passcode challenge with that identifier is open for this session.');
        }

        $result = $this->sessions->confirmContactVerification($session, $challenge, $payload['code']);

        if (! $result->verified) {
            throw $this->refusal($result);
        }

        return ApiResponse::data([
            'session' => $this->presenter->session($session),
            'customer_account' => $this->presenter->account($session->customerAccount),
        ]);
    }

    /**
     * One failed verification, as an error envelope.
     *
     * The `default` arm exists because `reason` is a `?string` the domain may
     * extend, and a `match` that fell through would be a `\UnhandledMatchError`
     * — a 500 — for what is certainly still a bad code. Treating an unknown
     * reason as `otp.invalid` degrades honestly.
     */
    private function refusal(OtpVerificationResult $result): ApiException
    {
        return match ($result->reason) {
            OtpVerificationResult::REASON_EXPIRED,
            OtpVerificationResult::REASON_NOT_LIVE => new ApiException(ErrorCode::OtpExpired),
            OtpVerificationResult::REASON_ATTEMPTS_EXHAUSTED => new ApiException(ErrorCode::OtpAttemptsExceeded),
            OtpVerificationResult::REASON_LOCKED_OUT => new ApiException(
                ErrorCode::OtpLocked,
                details: $result->lockedUntil === null ? [] : ['locked_until' => $result->lockedUntil->toIso8601String()],
            ),
            default => new ApiException(
                ErrorCode::OtpInvalid,
                details: ['attempts_remaining' => $result->attemptsRemaining],
            ),
        };
    }
}
