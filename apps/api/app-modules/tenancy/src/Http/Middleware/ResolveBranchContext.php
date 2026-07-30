<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Http\Middleware;

use Closure;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Tenancy\Exceptions\BranchOutsideMembershipScope;
use Healthy360\Tenancy\Exceptions\OrganisationContextRequired;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves and validates the X-Branch-Id header inside the already-resolved
 * organisation context (alias: branch.context, stacked after org.context).
 *
 * Branch-scoped memberships (membership.branch_id set) may only operate in
 * their own branch: a differing header is rejected and an absent header
 * defaults the context to the membership's branch. Organisation-wide
 * memberships (branch_id NULL) may select any active branch or none.
 */
class ResolveBranchContext
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws OrganisationContextRequired
     * @throws BranchOutsideMembershipScope
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->context->hasOrganisation()) {
            throw new OrganisationContextRequired;
        }

        $membershipBranchId = $this->context->membership()?->branch_id;
        $branchId = $request->header('X-Branch-Id');

        if (! is_string($branchId) || trim($branchId) === '') {
            if ($membershipBranchId !== null) {
                $this->context->setBranch($membershipBranchId);
            }

            return $next($request);
        }

        if (! Str::isUuid($branchId)) {
            throw new BranchOutsideMembershipScope;
        }

        if ($membershipBranchId !== null && $membershipBranchId !== $branchId) {
            throw new BranchOutsideMembershipScope;
        }

        $branchExists = OrganisationBranch::withoutTenancy()
            ->whereKey($branchId)
            ->where('organisation_id', $this->context->organisationId())
            ->where('status', BranchStatus::Active)
            ->exists();

        if (! $branchExists) {
            throw new BranchOutsideMembershipScope;
        }

        $this->context->setBranch($branchId);

        return $next($request);
    }
}
