<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Controllers;

use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Http\Concerns\HandlesOtpChallenges;
use Healthy360\Verification\Presenters\VerificationPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/verification/challenges/{challenge} — where a code stands.
 *
 * A client that has been away — backgrounded on a phone, reloaded in a tab —
 * cannot reconstruct a countdown from its own clock without being wrong for
 * exactly the users whose clocks are wrong. This endpoint is how it re-reads
 * the truth: how long is left, how many attempts remain, when the resend button
 * unlocks.
 *
 * **Never the code, and never a hint of it.** The shape here is drawn entirely
 * from columns that outlive the request; the plaintext exists between
 * generation and delivery and nowhere else, so there is nothing here to leak.
 *
 * A challenge belonging to somebody else is indistinguishable from one that
 * does not exist: both are `resource.not_found`. A 403 would confirm that a
 * stolen identifier names something real.
 */
final class ChallengeShowController
{
    use HandlesOtpChallenges;

    public function __construct(private readonly VerificationPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $challenge): JsonResponse
    {
        $user = $this->currentUser($request);
        $record = $this->challengeFor($user, $challenge);

        return ApiResponse::data(['challenge' => $this->presenter->challenge($record)]);
    }
}
