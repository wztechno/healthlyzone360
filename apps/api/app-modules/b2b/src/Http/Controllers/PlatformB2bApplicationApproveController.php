<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\ApproveApplicationRequest;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/b2b/applications/{application}/approve — behind
 * `precondition`.
 *
 * Requires `b2b_application.decide_platform` — the judgement, and a **separate
 * code from `review_platform`**. Working a queue and settling a case are
 * different authorities, and a single `b2b.manage` would have made the
 * separation unexpressible.
 *
 * **Approval records the decision and creates nothing.** The organisation, the
 * trading account and the first invitations arrive from
 * `POST .../provision`, behind a third permission again. That split is the
 * important one on this endpoint: an approval can be revisited, and a
 * provisioned tenant cannot be un-provisioned, so the person who signs off
 * commercially need not be the person trusted to create tenants.
 *
 * Its own route and its own audit event, never a `PATCH status` (§4.15). The
 * two notes travel separately for the same reason they exist separately: a
 * credit judgement is not something the customer it assesses should read.
 *
 * `If-Match` decides between an approval and a simultaneous decline, a
 * withdrawal, or a colleague's information request. Exactly one may win.
 */
final class PlatformB2bApplicationApproveController
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
    public function __invoke(ApproveApplicationRequest $request, string $application): JsonResponse
    {
        $record = $this->locator->application($application);
        $payload = $request->payload();

        $approved = $this->applications->approve(
            $record,
            $this->currentUser($request),
            $payload['internal_note'],
            $payload['applicant_message'],
            $this->requiredLockVersion($request),
        );

        return ApiResponse::data(['application' => $this->presenter->review($approved)])
            ->withHeaders(['ETag' => '"'.$approved->lock_version.'"']);
    }
}
