<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use Healthy360\AccessAdministration\Http\Concerns\ReadsPrecondition;
use Healthy360\AccessAdministration\Http\Requests\UpdateMembershipScopeRequest;
use Healthy360\AccessAdministration\Presenters\TeamMemberPresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessAdministration\Services\MembershipAdministration;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/organisations/{organisation}/memberships/{membership} — where
 * this person works.
 *
 * The only `PATCH` on a membership, and the only part of one that is an
 * ordinary attribute rather than a lifecycle event. Branch scope moves both
 * ways and carries no consequence beyond itself; suspending and ending do, so
 * they are verbs with their own URLs.
 *
 * `null` means organisation-wide. The request rule is `present` rather than
 * `required` precisely so that null can be sent deliberately — on a `PATCH`,
 * "make this person organisation-wide" and "I forgot the field" are otherwise
 * the same request.
 *
 * The branch is resolved through the ordinary tenant-scoped query, never
 * `withoutTenancy()`, so the global scope is what refuses another tenant's
 * branch — the reasoning `OrganisationInvitationStoreController::branch()`
 * writes out in full. A cross-tenant identifier never becomes a readable row.
 */
final class OrganisationMembershipScopeUpdateController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly AccessAdministrationQuery $query,
        private readonly MembershipAdministration $administration,
        private readonly TeamMemberPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(
        UpdateMembershipScopeRequest $request,
        string $organisation,
        string $membership,
    ): JsonResponse {
        $tenant = $this->locator->contextOrganisation($organisation);
        $record = $this->locator->membership($membership);

        $updated = $this->administration->setScope(
            $record,
            $this->branch($request->branchId()),
            $this->requiredLockVersion($request),
        );

        return MembershipResponse::detail($updated, $tenant, $this->query, $this->presenter);
    }

    /**
     * @throws ApiException
     */
    private function branch(?string $branchId): ?OrganisationBranch
    {
        if ($branchId === null) {
            return null;
        }

        $branch = OrganisationBranch::query()->whereKey($branchId)->first();

        if (! $branch instanceof OrganisationBranch) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That branch does not exist in this organisation.',
                ['fields' => ['branch_id' => ['That branch does not exist in this organisation.']]],
            );
        }

        return $branch;
    }
}
