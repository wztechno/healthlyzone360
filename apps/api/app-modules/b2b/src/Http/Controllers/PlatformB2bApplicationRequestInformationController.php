<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\RequestApplicationInformationRequest;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/b2b/applications/{application}/request-information —
 * behind `precondition`.
 *
 * Requires `b2b_application.review_platform`. This is the endpoint that makes
 * `info_requested` worth being a state rather than a flag: it hands editing
 * rights back to the applicant **for named sections only**, while the
 * application keeps its place in the queue.
 *
 * The narrowing is the whole point. "We need your trade terms again" reopens
 * the trade-terms fields and nothing else, so a company cannot use a question
 * about payment as an opportunity to restate its legal name after a reviewer
 * has already checked it against a certificate. Naming **no** sections is
 * legitimate and means "we need documents, not answers" — nothing on the form
 * reopens.
 *
 * The applicant's answer rejoins the queue as `submitted` rather than
 * `in_review`: whether the same reviewer picks it up again is the reviewer's
 * decision, and pretending otherwise would put a case back in one person's lap
 * whether or not they were still there.
 *
 * `If-Match` guards the race that costs the most here — a reviewer asking a
 * question at the moment a colleague approves — and the loser gets a `409`
 * naming the state rather than a question asked of a company that has already
 * been let in.
 */
final class PlatformB2bApplicationRequestInformationController
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
    public function __invoke(RequestApplicationInformationRequest $request, string $application): JsonResponse
    {
        $record = $this->locator->application($application);

        $updated = $this->applications->requestInformation(
            $record,
            $this->currentUser($request),
            $request->information(),
            $request->sections(),
            $this->requiredLockVersion($request),
        );

        return ApiResponse::data(['application' => $this->presenter->review($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
