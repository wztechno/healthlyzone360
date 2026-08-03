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
 * POST /api/v1/b2b/applications/{application}/withdraw — behind `precondition`.
 *
 * The applicant's own exit, and a **different terminal state from a decline**.
 * Collapsing the two would make "how many companies did we turn down" an
 * unanswerable question, and it would also be a small lie told to the person
 * who changed their mind.
 *
 * Its own route rather than a `DELETE`: nothing is removed. The application
 * stays, the documents stay, the trail of who applied and what happened stays
 * — and the applicant's one live slot is freed, so they may start again.
 *
 * `If-Match` guards the race that actually happens here: an applicant
 * withdrawing at the moment a reviewer approves. Exactly one of those two
 * writes may win, and the validator is what decides rather than whichever
 * statement reached PostgreSQL first.
 */
final class B2bApplicationWithdrawController
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
        $actor = $this->currentUser($request);
        $record = $this->locator->ownApplication($application, $actor);

        $withdrawn = $this->applications->withdraw($record, $actor, $this->requiredLockVersion($request));

        return ApiResponse::data(['application' => $this->presenter->application($withdrawn)])
            ->withHeaders(['ETag' => '"'.$withdrawn->lock_version.'"']);
    }
}
