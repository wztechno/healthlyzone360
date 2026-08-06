<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Services;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\B2b\Contracts\InvitationMembershipGranter;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Illuminate\Support\Facades\DB;

/**
 * The write B1 could not make: an accepted invitation becomes a membership
 * carrying the role it named.
 *
 * ## It is the seeder's mechanism, deliberately
 *
 * `DemoTenantSeeder::membership()` has been creating memberships this way
 * since P0 — `updateOrCreate` on `(organisation_id, user_id)`, the template
 * role found by `organisation_id IS NULL AND code = ?`, and `membership_roles`
 * carrying a denormalised `organisation_id` for the RLS policy to match on.
 * Every demo owner, including `owner@verdant.test`, exists because of those
 * three writes. Reproducing them exactly is what makes an invited owner
 * indistinguishable from a seeded one; inventing a second path would have
 * produced two kinds of owner and one of them would have been subtly wrong.
 *
 * ## `withoutTenancy()` on every write, and it is not laziness
 *
 * The acceptor is not a member of the organisation yet — that is the whole
 * point of the request — so there is no tenant context to write under, and the
 * global scope would fail closed on exactly the statement that ends the
 * problem. The same reasoning the seeder applies, arrived at from the other
 * direction.
 *
 * ## Re-granting is a no-op, not a second membership
 *
 * `updateOrCreate` on the natural key, and the role assignment likewise. An
 * acceptance is single-use, but a retry whose response was lost must not
 * produce a duplicate — and a person invited a second time to an organisation
 * they already belong to gets their existing membership reactivated rather
 * than a unique-constraint violation.
 *
 * ## A branch-scoped invitation stays branch-scoped
 *
 * `organisation_memberships.branch_id` is null for organisation-wide access
 * and set for a single branch; the invitation already carries the distinction,
 * so it is copied rather than re-decided.
 */
final readonly class MembershipGranter implements InvitationMembershipGranter
{
    public function grant(OrganisationInvitation $invitation, User $acceptor): ?string
    {
        $role = $this->role($invitation);

        if (! $role instanceof Role) {
            // An invitation naming a role that no longer resolves is not an
            // error the acceptor can do anything about, and refusing would
            // strand a valid acceptance. The row is already stamped; reporting
            // `membership_created: false` puts the problem in front of whoever
            // issued it.
            return null;
        }

        return DB::transaction(function () use ($invitation, $acceptor, $role): string {
            $membership = OrganisationMembership::withoutTenancy()->updateOrCreate(
                [
                    'organisation_id' => $invitation->organisation_id,
                    'user_id' => (string) $acceptor->getKey(),
                ],
                [
                    'branch_id' => $invitation->branch_id,
                    'status' => MembershipStatus::Active,
                    'joined_at' => now(),
                    'created_by' => $invitation->invited_by,
                ],
            );

            MembershipRole::withoutTenancy()->updateOrCreate(
                ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
                [
                    'organisation_id' => $invitation->organisation_id,
                    'created_by' => $invitation->invited_by,
                ],
            );

            return (string) $membership->getKey();
        });
    }

    /**
     * The role an invitation's `role_code` names.
     *
     * The organisation's own role wins over the platform template of the same
     * code. A tenant that has defined `organisation_owner` for itself means
     * that one, and handing the invited person the template instead would give
     * them a different set of permissions from every other owner in the same
     * organisation.
     */
    private function role(OrganisationInvitation $invitation): ?Role
    {
        $bespoke = Role::withoutTenancy()
            ->where('organisation_id', $invitation->organisation_id)
            ->where('code', $invitation->role_code)
            ->first();

        if ($bespoke instanceof Role) {
            return $bespoke;
        }

        return Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('code', $invitation->role_code)
            ->first();
    }
}
