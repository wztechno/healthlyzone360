<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use Healthy360\AccessAdministration\Http\Concerns\ReadsPrecondition;
use Healthy360\AccessAdministration\Http\Concerns\ResolvesActorAuthority;
use Healthy360\AccessAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\AccessAdministration\Http\Requests\ReplaceMembershipRolesRequest;
use Healthy360\AccessAdministration\Presenters\TeamMemberPresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessAdministration\Services\MembershipRoleAssigner;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/organisations/{organisation}/memberships/{membership}/roles —
 * this person holds exactly these roles.
 *
 * `PUT`, and the whole set, because that is the decision an administrator
 * actually makes. Expressed as add-and-remove it becomes three requests with
 * two intermediate states, one of which is "holds nothing" and another "holds
 * both the old role and the new" — and on a permission table an intermediate
 * state is not untidiness, it is authority nobody granted.
 *
 * Gated on `role.manage_organisation` rather than
 * `membership.update_organisation`, because that code's own description reads
 * "Manage roles **and role assignments** of the organisation". Changing where
 * somebody works is a membership edit; changing what they may do is a role
 * decision, and a kitchen may reasonably let a branch manager do the first
 * without the second.
 *
 * `precondition` carries the *membership's* version, even though none of its
 * own columns change. Two administrators re-roling one person is exactly the
 * race worth detecting, and `membership_roles` is a child table with no version
 * of its own to compare — so the parent's is bumped as part of the replacement
 * and becomes the thing they collide on.
 */
final class MembershipRoleReplaceController
{
    use ReadsPrecondition;
    use ResolvesActorAuthority;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly AccessAdministrationQuery $query,
        private readonly MembershipRoleAssigner $assigner,
        private readonly TeamMemberPresenter $presenter,
        private readonly PermissionChecker $checker,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(
        ReplaceMembershipRolesRequest $request,
        string $organisation,
        string $membership,
    ): JsonResponse {
        $tenant = $this->locator->contextOrganisation($organisation);
        $record = $this->locator->membership($membership);

        $actor = $this->currentUser($request);

        $this->assigner->replace(
            $record,
            $request->payload(),
            $this->requiredLockVersion($request),
            $actor,
            $this->actorMembershipId($this->tenant),
            $this->actorCodes($actor, $this->tenant, $this->checker),
        );

        return MembershipResponse::detail(
            $record->refresh(),
            $tenant,
            $this->query,
            $this->presenter,
        );
    }
}
