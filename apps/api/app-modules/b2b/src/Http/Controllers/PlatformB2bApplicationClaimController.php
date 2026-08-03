<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/b2b/applications/{application}/claim — behind
 * `precondition`.
 *
 * Requires `b2b_application.review_platform`. Claiming moves the file along
 * without settling anything: it stamps `reviewed_by` and `review_started_at`
 * and takes the application to `in_review`, which is what stops two people
 * working the same case in parallel and finding out afterwards.
 *
 * Named "claim" rather than "start review" because that is what it is. The
 * state is `in_review`; the act is one person putting their name on it.
 *
 * **`If-Match` is what makes the claim exclusive.** Two reviewers who both
 * opened the queue hold the same validator, and the second write finds
 * `lock_version` moved and loses with a `409` naming the current state. Without
 * it, both would succeed and the last one would silently own the case.
 *
 * There is no unclaim endpoint, and that absence is deliberate rather than
 * missing: `ApplicationStatus` has no route from `in_review` back to
 * `submitted`, because "I picked this up and put it down again" is not a state
 * the applicant should watch their application oscillate through. A reviewer
 * who cannot finish hands over by asking the applicant for information, or by
 * deciding.
 */
final class PlatformB2bApplicationClaimController
{
    use ReadsPrecondition;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly ApplicationService $applications,
        private readonly B2bApplicationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $application): JsonResponse
    {
        $record = $this->locator->application($application);

        $claimed = $this->applications->startReview(
            $record,
            $this->currentUser($request),
            $this->requiredLockVersion($request),
        );

        return ApiResponse::data(['application' => $this->presenter->review($claimed)])
            ->withHeaders(['ETag' => '"'.$claimed->lock_version.'"']);
    }
}
