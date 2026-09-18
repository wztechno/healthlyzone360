<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Services;

use App\Models\User;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * What may go into a role, and — separately — who may put it there.
 *
 * The two questions are answered by two methods on purpose, because they are
 * different kinds of rule and only one of them is settled.
 *
 * ## `assertOrganisationScoped()` — a boundary, not a policy
 *
 * A platform code must never reach an organisation role. That is not a
 * configuration choice a deployment could take differently: the registry is
 * split in two precisely so `templateRoles()` cannot build one from a platform
 * code, `PermissionRegistryTest` proves the split holds, and this is the same
 * invariant at the one place a *tenant* could otherwise write a grant by hand.
 * `reference.manage_platform` on a kitchen's bespoke role would be a tenant
 * editing the regulatory allergen vocabulary every other tenant shares.
 *
 * It is checked against `PermissionRegistry::organisationPermissions()` rather
 * than against the `_platform` suffix. The suffix convention is real and
 * asserted, but it is a naming rule, and a naming rule is the wrong thing to
 * build a tenant boundary out of.
 *
 * `is_assignable` is enforced in the same pass because the consequence is the
 * same shape: `PermissionChecker::calculatedPermissions()` drops those codes
 * when it works out what somebody may do, so a role carrying one would appear
 * to grant an authority and would not.
 *
 * A 422 rather than a 403, and the distinction is exactly the one
 * `ErrorCode::AuthzPermissionDenied`'s neighbours draw: nothing is wrong with
 * *who is asking*. The caller may manage roles perfectly well. What is wrong is
 * the request body, and it names a field, so a form can put the message beside
 * the checkbox that caused it.
 *
 * ## `assertMayGrant()` — a decision that was taken, and left reversible
 *
 * Whether an administrator may grant a code they do not themselves hold is a
 * genuine product question, and AA1 answers it **yes**: whoever holds
 * `role.manage_organisation` may grant any organisation-scoped code. The
 * argument for it is that a kitchen's administrator is trusted with access as a
 * job — the same way `organisation_owner` is — and a no-escalation rule would
 * mostly trap a narrowly-scoped administrator trying to do the thing their role
 * exists for. The argument against it is the ordinary one: a narrow
 * administrator can promote a second account and then sign into it.
 *
 * The method therefore exists and permits everything, rather than not existing.
 * That is not a stub left by accident — it is the shape that makes the decision
 * reversible in one place. Both write paths already call it, so tightening the
 * rule later is a method body and a test, not a hunt for call sites; and
 * `GET /permissions` already serves `held_by_caller` per code, so the editor can
 * mark what an administrator is granting beyond their own reach without any of
 * this changing.
 */
final readonly class GrantBoundary
{
    /**
     * Refuse a grant set containing anything an organisation role may not hold.
     *
     * @param  list<string>  $codes
     * @return list<string> the same codes, de-duplicated and in catalogue order
     *
     * @throws ApiException
     */
    public function assertOrganisationScoped(array $codes): array
    {
        $codes = array_values(array_unique($codes));

        $grantable = Permission::query()
            ->whereIn('code', array_keys(PermissionRegistry::organisationPermissions()))
            ->where('is_assignable', true)
            ->orderBy('code')
            ->pluck('code')
            ->all();

        $refused = array_values(array_diff($codes, $grantable));

        if ($refused !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'A role of this organisation cannot hold those permissions.',
                [
                    'fields' => ['permissions' => ['These permissions cannot be granted to an organisation role.']],
                    'refused_codes' => $refused,
                ],
            );
        }

        // Catalogue order rather than submission order, so a role's grant list
        // reads the same however the form happened to serialise its checkboxes,
        // and two saves that changed nothing produce the same rows.
        return array_values(array_intersect($grantable, $codes));
    }

    /**
     * Whether this actor may grant these codes.
     *
     * Permits everything, deliberately — see the class comment. The parameters
     * are present and named so that the call sites already pass what a stricter
     * rule would need.
     *
     * @param  list<string>  $codes
     * @param  list<string>  $actorCodes
     *
     * @throws ApiException
     */
    public function assertMayGrant(array $codes, User $actor, array $actorCodes): void
    {
        // No escalation guard in AA1. If this is ever revisited, the refusal
        // belongs here and nowhere else:
        //
        //     $beyond = array_values(array_diff($codes, $actorCodes));
        //     if ($beyond !== []) { throw new ApiException(ErrorCode::AuthzPermissionDenied, ...); }
    }
}
