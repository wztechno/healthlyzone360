<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Http\Controllers;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Presenters\OrganisationPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/organisations/current — the organisation-scoped probe of the
 * foundation vertical slice.
 *
 * It carries no business logic on purpose. Its value is the middleware stack
 * it sits behind: X-Organisation-Id and X-Branch-Id validated against a real
 * active membership (org.context, branch.context) and the six-step RBAC
 * decision for `organisation.view_current` (permission). Reaching this
 * handler at all is the proof that headers, membership and permissions work
 * end to end; every failure mode has its own distinct error code.
 */
final class CurrentOrganisationController
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly OrganisationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(): JsonResponse
    {
        $organisationId = $this->context->organisationId();

        $organisation = $organisationId === null
            ? null
            : Organisation::query()->with('type')->find($organisationId);

        // Unreachable behind org.context; a routing mistake must still fail
        // closed rather than expose an empty context.
        if (! $organisation instanceof Organisation) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        $branchId = $this->context->branchId();
        $branch = $branchId === null ? null : OrganisationBranch::query()->find($branchId);

        return ApiResponse::data([
            'organisation' => $this->presenter->organisation($organisation),
            'branch' => $branch instanceof OrganisationBranch ? $this->presenter->branch($branch) : null,
        ]);
    }
}
