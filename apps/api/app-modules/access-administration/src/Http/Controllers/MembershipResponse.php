<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use App\Models\User;
use Healthy360\AccessAdministration\Presenters\TeamMemberPresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * The one shape every membership write answers with.
 *
 * Five endpoints — role replacement, scope, suspend, reactivate, end — all
 * return the same membership detail, the same `ETag`, and the same
 * `remaining_role_administrators` and `branches`. Factored here rather than repeated five
 * times because a console reads the response to redraw the row it just changed,
 * and five near-identical assemblies are five chances for one of them to drop
 * a field and for a screen to quietly stop updating.
 *
 * It is a plain static assembler rather than a service: it holds no state,
 * makes no decisions and has nothing to inject. Promoting it to the service
 * layer would suggest it did.
 */
final class MembershipResponse
{
    public static function detail(
        OrganisationMembership $membership,
        Organisation $organisation,
        AccessAdministrationQuery $query,
        TeamMemberPresenter $presenter,
        int $status = 200,
    ): JsonResponse {
        $assignments = $query->assignmentsFor((string) $membership->getKey());
        $roleIds = array_column($assignments, 'role_id');

        $roles = Role::query()->whereIn('id', $roleIds)->get()
            ->keyBy(static fn (Role $role): string => (string) $role->getKey());

        $user = User::query()->with('profile')->whereKey($membership->user_id)->first();

        $detail = $presenter->detail(
            $membership,
            $user instanceof User ? $user : null,
            array_values(array_filter(array_map(
                static fn (string $roleId): ?Role => $roles->get($roleId),
                $roleIds,
            ))),
            $membership->branch,
            $assignments,
            $query->codesForRoleSet($roleIds),
        );

        $remaining = $query->roleAdministratorsOf(
            (string) $organisation->getKey(),
            excludingMembershipId: (string) $membership->getKey(),
        );

        return ApiResponse::data(
            ['membership' => $detail],
            // Reported, never enforced. The API does not refuse to remove the
            // last other administrator — PA1's `remaining_owners` settled that
            // a console refusing the thing an operator opened it to do is a
            // control that has made itself unusable — so this is how the screen
            // gets to warn.
            [
                'remaining_role_administrators' => count($remaining),
                // The scope picker's vocabulary, on every one of the five
                // rather than on the read alone. All five answer through this
                // assembler and the client maps all five with one mapper, so a
                // read-only field would come back empty from a save and empty
                // the picker the moment somebody used it. See
                // `AccessAdministrationQuery::branchesOf()` for why the list
                // has to come from the server at all.
                'branches' => $query->branchesOf((string) $organisation->getKey()),
            ],
            status: $status,
        )->header('ETag', '"'.(int) $membership->lock_version.'"');
    }
}
