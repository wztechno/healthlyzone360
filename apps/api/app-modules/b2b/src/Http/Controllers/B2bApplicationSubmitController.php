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
 * POST /api/v1/b2b/applications/{application}/submit — behind `precondition`.
 *
 * Its own route and its own audit event, never a `PATCH status` (master plan
 * v2 §4.15). Sending an application is a decision the applicant makes once,
 * and modelling it as a field would put it on the same code path as correcting
 * a typo.
 *
 * **The server decides what complete means.** `completed_sections` is the
 * applicant's own progress claim and is never consulted: readiness is computed
 * from the data actually present *and* from the required document kinds, so a
 * checklist enforced only in a wizard is not a checklist an API client can
 * skip. Both failures come back at once —
 * `details.missing_fields` and `details.missing_documents` — because somebody
 * should learn everything that is wrong in one round trip. The code is
 * `b2b.documents_incomplete` when the checklist is short and `validation.failed`
 * when only form fields are, since those send a client to different screens.
 *
 * `If-Match` guards a genuine race: a reviewer who has just handed the
 * application back with questions and an applicant who submitted from a stale
 * tab are the two halves of one lost update, and the validator is what makes
 * the second one lose.
 */
final class B2bApplicationSubmitController
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

        $submitted = $this->applications->submit($record, $actor, $this->requiredLockVersion($request));

        return ApiResponse::data(['application' => $this->presenter->application($submitted)])
            ->withHeaders(['ETag' => '"'.$submitted->lock_version.'"']);
    }
}
