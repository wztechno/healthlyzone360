<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/platform/b2b/offboardings/{offboarding} — where a wind-up has
 * got to.
 *
 * **The states exist so that an operator can see where a wind-up has stalled**,
 * which is the whole reason `OffboardingService` refuses to cascade: it would
 * be shorter to have sign-off revoke and archive in one transaction, and it
 * would make the states decorative. This is the endpoint that makes them worth
 * having, so the shape carries every stage's timestamps rather than a single
 * `status` and a guess.
 *
 * `allowed_transitions` travels with the row. A wind-up screen renders buttons,
 * and a client that had to reimplement the state machine to know which ones to
 * enable would be a second copy of it — the one that disagrees after the first
 * change.
 *
 * The `ETag` is served for the same reason the applications surface serves one.
 * None of the action endpoints demands `If-Match`: the transitions are guarded
 * by the *state machine*, which is a stronger guarantee than "only if nobody
 * touched it since you looked" — `signed_off → signed_off` is illegal whatever
 * validator you hold — and a 428 on every step would add ceremony to a
 * nine-step process without preventing anything the status check does not.
 */
final class OffboardingShowController
{
    use ResolvesOffboarding;

    public function __construct(private readonly OffboardingPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $offboarding): JsonResponse
    {
        $record = $this->offboarding($offboarding);

        return ApiResponse::data(['offboarding' => $this->presenter->offboarding($record)])
            ->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
