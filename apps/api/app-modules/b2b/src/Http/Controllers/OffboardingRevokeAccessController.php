<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/b2b/offboardings/{offboarding}/revoke-access — start
 * taking access away.
 *
 * **The irreversible one, and the only step in this family that carries
 * `Idempotency-Key`.** Everything before it can be called off; from here it
 * cannot, because "cancelling" a revocation would mean silently re-granting
 * access somebody deliberately removed. A double tap on a slow connection would
 * dispatch `RevokeBusinessAccess` twice against one wind-up, and while the job
 * is written to be re-runnable, the honest place to stop a duplicated
 * irreversible command is before it is issued — the same argument
 * `POST /orders` makes and the same middleware.
 *
 * The key is **optional**, as it is everywhere else on the platform: an
 * endpoint that refused unkeyed requests would break every caller that has ever
 * worked, to protect them from a risk they may not have. Unlike provisioning,
 * which refuses a missing key in the controller, the state machine already
 * refuses a second call — `revoking → revoking` is not a legal transition — so
 * the key buys a clean replayed envelope rather than the only line of defence.
 *
 * **The transition is written here and the work is done by the job.** Ending
 * every membership in an organisation, deleting tokens and closing the
 * organisation is more work than a request should hold, and a queued job can be
 * retried — which is the property the one step that can partially fail most
 * needs. So the response comes back at `revoking` with
 * `revocation.started_at` set and the counts still null; `GET` the wind-up to
 * see them fill in.
 */
final class OffboardingRevokeAccessController
{
    use ResolvesAuthenticatedUser;
    use ResolvesOffboarding;

    public function __construct(
        private readonly OffboardingService $offboardings,
        private readonly OffboardingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $offboarding): JsonResponse
    {
        $record = $this->offboarding($offboarding);

        $revoking = $this->offboardings->revokeAccess($record, $this->currentUser($request));

        return ApiResponse::data(['offboarding' => $this->presenter->offboarding($revoking)], status: 202)
            ->withHeaders(['ETag' => '"'.$revoking->lock_version.'"']);
    }
}
