<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Concerns;

use App\Models\User;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\Tenancy\TenantContext;

/**
 * What the caller currently holds, and which membership holds it.
 *
 * Every write in this module needs both, and for one reason: this is the only
 * tenant surface where the caller is *inside* the thing being changed.
 * Removing a permission from a role can remove it from the person removing it;
 * ending a membership can end their own. Both guards are computed against the
 * actor, so the actor has to be resolved the same way every time.
 *
 * The codes come from `PermissionChecker` rather than being recomputed, because
 * this is a question about the present and the cache is the right answer to it.
 * The *hypothetical* — what somebody would hold after a save — is a different
 * question and belongs to `AccessAdministrationQuery`, which reads through no
 * cache at all.
 *
 * A membership is guaranteed present by `org.context`, so the null branches are
 * unreachable in practice. They fail open on the *information* rather than on
 * the decision: no membership means no codes, which means a lock-out guard with
 * nothing to protect, which is the correct answer for a caller who has no
 * standing in the organisation to lose.
 */
trait ResolvesActorAuthority
{
    protected function actorMembershipId(TenantContext $tenant): ?string
    {
        $membership = $tenant->membership();

        return $membership === null ? null : (string) $membership->getKey();
    }

    /** @return list<string> */
    protected function actorCodes(User $actor, TenantContext $tenant, PermissionChecker $checker): array
    {
        $membership = $tenant->membership();

        if ($membership === null) {
            return [];
        }

        return $checker->calculatedPermissions($actor, $membership, $tenant);
    }
}
