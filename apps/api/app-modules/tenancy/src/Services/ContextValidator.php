<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Services;

use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\Exceptions\BranchOutsideMembershipScope;
use Healthy360\Tenancy\Exceptions\OrganisationContextForbidden;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * The single server-side validation of a claimed organisation and branch
 * context (plan §9). Both the context middleware (header-driven) and the
 * PUT /api/v1/me/context endpoint (body-driven) go through here, so a
 * client can never reach a context by one route that the other would reject.
 *
 * Fails closed: anything unparseable, unknown, inactive or out of scope is a
 * denial, and the denial never reveals whether the organisation exists.
 *
 * Validation necessarily runs *before* the context it is validating exists,
 * so its queries opt out of the ambient scoping in both layers: through
 * withoutTenancy() at the application layer and through
 * DatabaseTenantContext::during() at the database layer. Both bypasses are
 * bounded by an already-proven active membership.
 */
final class ContextValidator
{
    public function __construct(private readonly DatabaseTenantContext $session) {}

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
     * the organisation, or none when several exist. When exactly one active
     * branch exists it is applied automatically.
     *
     * @throws BranchOutsideMembershipScope
     */
    public function branch(OrganisationMembership $membership, ?string $branchId): ?string
    {
        $membershipBranchId = $membership->branch_id;
        $claimed = is_string($branchId) ? trim($branchId) : '';

        if ($claimed === '') {
            if ($membershipBranchId !== null) {
                return $membershipBranchId;
            }

            // Organisation-wide memberships with exactly one active branch are
            // not offered a picker on the client — the mock applies the branch
            // the same way, and kitchen/POS/KDS routes require branch context.
            return $this->soleActiveBranchId($membership);
        }

        if (! Str::isUuid($claimed)) {
            throw new BranchOutsideMembershipScope;
        }

        if ($membershipBranchId !== null && $membershipBranchId !== $claimed) {
            throw new BranchOutsideMembershipScope;
        }

        // The membership is already proven active in this organisation, so
        // declaring it to the database session for one existence check grants
        // nothing the caller does not already hold — and without it the RLS
        // policy would hide the branch and turn a valid selection into
        // "outside your scope".
        $exists = $this->session->during(null, (string) $membership->organisation_id, null, fn (): bool => OrganisationBranch::withoutTenancy()
            ->whereKey($claimed)
            ->where('organisation_id', $membership->organisation_id)
            ->where('status', BranchStatus::Active)
            ->exists());

        if (! $exists) {
            throw new BranchOutsideMembershipScope;
        }

        return $claimed;
    }

    /**
     * When an organisation has a single active branch there is nothing to
     * choose; return it so context hydration and branch-gated surfaces agree.
     */
    private function soleActiveBranchId(OrganisationMembership $membership): ?string
    {
        $branchIds = $this->session->during(
            null,
            (string) $membership->organisation_id,
            null,
            fn (): Collection => OrganisationBranch::withoutTenancy()
                ->where('organisation_id', $membership->organisation_id)
                ->where('status', BranchStatus::Active)
                ->pluck('id'),
        );

        if ($branchIds->count() !== 1) {
            return null;
        }

        return (string) $branchIds->first();
    }
}
