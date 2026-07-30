<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Services;

use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\Exceptions\BranchOutsideMembershipScope;
use Healthy360\Tenancy\Exceptions\OrganisationContextForbidden;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Str;

/**
 * The single server-side validation of a claimed organisation and branch
 * context (plan §9). Both the context middleware (header-driven) and the
 * PUT /api/v1/me/context endpoint (body-driven) go through here, so a
 * client can never reach a context by one route that the other would reject.
 *
 * Fails closed: anything unparseable, unknown, inactive or out of scope is a
 * denial, and the denial never reveals whether the organisation exists.
 */
final class ContextValidator
{
    /**
     * @throws OrganisationContextForbidden
     */
    public function membership(?Authenticatable $user, ?string $organisationId): OrganisationMembership
    {
        $membership = $this->findMembership($user, $organisationId);

        if ($membership === null) {
            throw new OrganisationContextForbidden;
        }

        return $membership;
    }

    /**
     * The active membership, or null when the claim cannot be validated.
     * Used where an invalid remembered context must silently degrade to "no
     * context" rather than fail the request.
     */
    public function findMembership(?Authenticatable $user, ?string $organisationId): ?OrganisationMembership
    {
        if ($user === null || ! is_string($organisationId) || ! Str::isUuid(trim($organisationId))) {
            return null;
        }

        return OrganisationMembership::withoutTenancy()
            ->where('organisation_id', trim($organisationId))
            ->where('user_id', $user->getAuthIdentifier())
            ->where('status', MembershipStatus::Active)
            ->first();
    }

    /**
     * Resolve the branch a request may operate in.
     *
     * A branch-scoped membership may only work inside its own branch: a
     * differing claim is rejected and an absent claim defaults to that
     * branch. An organisation-wide membership may select any active branch of
     * the organisation, or none at all.
     *
     * @throws BranchOutsideMembershipScope
     */
    public function branch(OrganisationMembership $membership, ?string $branchId): ?string
    {
        $membershipBranchId = $membership->branch_id;
        $claimed = is_string($branchId) ? trim($branchId) : '';

        if ($claimed === '') {
            return $membershipBranchId;
        }

        if (! Str::isUuid($claimed)) {
            throw new BranchOutsideMembershipScope;
        }

        if ($membershipBranchId !== null && $membershipBranchId !== $claimed) {
            throw new BranchOutsideMembershipScope;
        }

        $exists = OrganisationBranch::withoutTenancy()
            ->whereKey($claimed)
            ->where('organisation_id', $membership->organisation_id)
            ->where('status', BranchStatus::Active)
            ->exists();

        if (! $exists) {
            throw new BranchOutsideMembershipScope;
        }

        return $claimed;
    }
}
