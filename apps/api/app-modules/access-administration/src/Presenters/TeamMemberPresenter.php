<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Presenters;

use App\Models\User;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;

/**
 * The wire shape of somebody who works here.
 *
 * ## The email address is served in full, and that is a deliberate departure
 *
 * `Invitation.emailMasked` exists because the invitation read is *anonymous* —
 * the token is the only credential, and an unmasked address would turn a mailed
 * link into a working address for whoever found it. Neither half of that
 * applies here. The caller is an authenticated member of the organisation
 * holding `membership.view_organisation`, and the address is the one thing that
 * makes the list usable: it is the login identifier, so an administrator who
 * cannot read it cannot tell two people with the same name apart, cannot answer
 * "which account is this", and cannot help somebody who has typed it wrongly.
 *
 * ## Roles are named, not just identified
 *
 * `roles` carries the code **and** both display names. The code is what the
 * client keys on — `MembershipGranter` matches on it, and a bespoke role may
 * legitimately shadow a template's — and the names are what a chip renders
 * without a second request. This is the same shape `Invitation.roleCode`
 * settles on one relationship over, widened because here the console genuinely
 * has the names to hand.
 *
 * ## Branch scope is a null, not a flag
 *
 * `organisation_memberships.branch_id` is null for organisation-wide access and
 * set for one branch, so `branch` is null or an object. A boolean beside an
 * identifier would make "organisation-wide, branch A" representable, which is
 * not a thing.
 */
final class TeamMemberPresenter
{
    /**
     * @param  list<Role>  $roles
     * @return array<string, mixed>
     */
    public function summary(
        OrganisationMembership $membership,
        ?User $user,
        array $roles,
        ?OrganisationBranch $branch,
    ): array {
        $profile = $user?->profile;

        return [
            'membership_id' => (string) $membership->getKey(),
            'user_id' => (string) $membership->user_id,
            // Null rather than an empty string when a profile has not been
            // written yet: the console renders the email address in its place,
            // and "" would render as a blank cell that looks like a bug.
            'given_name' => $profile?->given_name,
            'family_name' => $profile?->family_name,
            'email' => $user?->email,
            'status' => $membership->status->value,
            'joined_at' => $membership->joined_at?->toIso8601String(),
            'branch' => $branch === null ? null : [
                'id' => (string) $branch->getKey(),
                'name' => (string) $branch->name,
            ],
            'roles' => array_map(static fn (Role $role): array => [
                'id' => (string) $role->getKey(),
                'code' => (string) $role->code,
                'name_en' => (string) $role->name_en,
                'name_ar' => (string) $role->name_ar,
                'is_system' => (bool) $role->is_system,
            ], $roles),
            'lock_version' => (int) $membership->lock_version,
        ];
    }

    /**
     * The detail row: the summary, the time bounds on each assignment, and the
     * codes the assignments add up to.
     *
     * `permissions` is computed rather than implied, because a person holding
     * two roles holds their union and no client should be re-deriving that from
     * a role list. It is also the honest answer to the question the detail page
     * exists to answer — not "which roles does this person have" but "what can
     * this person do".
     *
     * @param  list<Role>  $roles
     * @param  list<array{role_id: string, starts_at: ?string, expires_at: ?string}>  $assignments
     * @param  list<string>  $permissionCodes
     * @return array<string, mixed>
     */
    public function detail(
        OrganisationMembership $membership,
        ?User $user,
        array $roles,
        ?OrganisationBranch $branch,
        array $assignments,
        array $permissionCodes,
    ): array {
        return [
            ...$this->summary($membership, $user, $roles, $branch),
            'assignments' => $assignments,
            'permissions' => $permissionCodes,
        ];
    }
}
