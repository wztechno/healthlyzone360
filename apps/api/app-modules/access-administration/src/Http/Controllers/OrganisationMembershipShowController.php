<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use App\Models\User;
use Healthy360\AccessAdministration\Presenters\TeamMemberPresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/organisations/{organisation}/memberships/{membership} — one
 * person, their roles and what those roles add up to.
 *
 * The detail carries `permissions`: the union of every code the assigned roles
 * grant. That is the question the page exists to answer — not "which roles does
 * she hold" but "what can she do" — and it is a union the client must not be
 * left to compute, because two roles overlapping is the ordinary case and a
 * client that got it wrong would be wrong quietly.
 *
 * It also carries `remaining_role_administrators` in `meta`: how many *other*
 * active memberships could still administer access if this one stopped.
 * Serving it on the read rather than only on the writes is what lets the page
 * warn **before** somebody presses End rather than after — the shape PA1's
 * `remaining_owners` established, moved one step earlier because here the
 * person being removed may be looking at their own row.
 *
 * The `ETag` is the membership's `lock_version`, which every write on this
 * resource requires back in `If-Match`.
 */
final class OrganisationMembershipShowController
{
    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly AccessAdministrationQuery $query,
        private readonly TeamMemberPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $organisation, string $membership): JsonResponse
    {
        $tenant = $this->locator->contextOrganisation($organisation);
        $record = $this->locator->membership($membership);

        $assignments = $this->query->assignmentsFor((string) $record->getKey());
        $roleIds = array_column($assignments, 'role_id');

        $roles = Role::query()->whereIn('id', $roleIds)->get()
            ->keyBy(static fn (Role $role): string => (string) $role->getKey());

        $detail = $this->presenter->detail(
            $record,
            $this->user($record),
            array_values(array_filter(array_map(
                static fn (string $roleId): ?Role => $roles->get($roleId),
                $roleIds,
            ))),
            $record->branch,
            $assignments,
            $this->query->codesForRoleSet($roleIds),
        );

        $remaining = $this->query->roleAdministratorsOf(
            (string) $tenant->getKey(),
            excludingMembershipId: (string) $record->getKey(),
        );

        return ApiResponse::data(
            ['membership' => $detail],
            [
                'remaining_role_administrators' => count($remaining),
                // The scope picker's vocabulary, matching what
                // `MembershipResponse` puts on the four writes. See
                // `AccessAdministrationQuery::branchesOf()` for why the list
                // has to come from the server: nothing else this console can
                // reach lists a kitchen's branches, and a picker that cannot
                // name one drops it on the next save.
                'branches' => $this->query->branchesOf((string) $tenant->getKey()),
            ],
        )->header('ETag', '"'.(int) $record->lock_version.'"');
    }

    private function user(OrganisationMembership $membership): ?User
    {
        $user = User::query()->with('profile')->whereKey($membership->user_id)->first();

        return $user instanceof User ? $user : null;
    }
}
