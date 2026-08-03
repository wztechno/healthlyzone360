<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/b2b/applications — begin a corporate application.
 *
 * **No permission code, and none is missing.** An applicant is not a member of
 * anything yet — the whole point of this journey is that they have no
 * organisation — so there is nothing for an organisation-scoped permission to
 * be scoped to and no platform authority they could plausibly hold. What
 * stands in for authorisation is ownership, and ownership is a fact the
 * service checks on every subsequent write: `applicant_user_id` is stamped
 * here and never moves.
 *
 * The body is empty on purpose. A draft is a container, and asking somebody to
 * name their company before they have seen the form is how a wizard acquires a
 * step nobody wanted. Everything arrives through the section PATCHes.
 *
 * **One live application per person**, enforced by a partial unique index and
 * refused here with `409 resource.conflict` naming the application already in
 * progress — never a second draft that silently orphans the first.
 */
final class B2bApplicationStoreController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly ApplicationService $applications,
        private readonly B2bApplicationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $application = $this->applications->startDraft($this->currentUser($request));

        return ApiResponse::data(['application' => $this->presenter->application($application)], status: 201)
            ->withHeaders(['ETag' => '"'.$application->lock_version.'"']);
    }
}
