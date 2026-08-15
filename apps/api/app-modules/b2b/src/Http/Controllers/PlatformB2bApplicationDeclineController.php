<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\DeclineApplicationRequest;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/b2b/applications/{application}/decline — behind
 * `precondition`.
 *
 * Requires `b2b_application.decide_platform`, the same authority as approving,
 * because a refusal is as much a decision as an acceptance and holding one
 * without the other would be a permission model with an opinion about which
 * answer is the serious one.
 *
 * **`applicant_message` is required**, and the service refuses a blank one too.
 * An unexplained refusal is not a decision the company can act on: they cannot
 * tell whether to correct a document, apply again next year, or stop trying.
 * Thirty seconds of a reviewer's time is the difference between a decision and
 * a wall.
 *
 * A decline is **terminal and distinct from a withdrawal**. The applicant's own
 * exit is its own state, counted separately, because collapsing the two would
 * make "how many did we turn down" unanswerable. Declining also frees the
 * applicant's one live slot, so a company that fixes what was wrong may start
 * again — the state machine allows `info_requested → declined` for the same
 * reason.
 */
final class PlatformB2bApplicationDeclineController
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
    public function __invoke(DeclineApplicationRequest $request, string $application): JsonResponse
    {
        $record = $this->locator->application($application);
        $payload = $request->payload();

        $declined = $this->applications->decline(
            $record,
            $this->currentUser($request),
            $payload['applicant_message'],
            $payload['internal_note'],
            $this->requiredLockVersion($request),
        );

        return ApiResponse::data(['application' => $this->presenter->review($declined)])
            ->withHeaders(['ETag' => '"'.$declined->lock_version.'"']);
    }
}
