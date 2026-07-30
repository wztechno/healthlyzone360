<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Http\Middleware;

use Closure;
use Healthy360\Tenancy\Exceptions\BranchOutsideMembershipScope;
use Healthy360\Tenancy\Exceptions\OrganisationContextRequired;
use Healthy360\Tenancy\Services\ContextValidator;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
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
    public function __construct(
        private readonly TenantContext $context,
        private readonly ContextValidator $validator,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws OrganisationContextRequired
     * @throws BranchOutsideMembershipScope
     */
    public function handle(Request $request, Closure $next): Response
    {
        $membership = $this->context->membership();

        if (! $this->context->hasOrganisation() || $membership === null) {
            throw new OrganisationContextRequired;
        }

        $branchId = $this->validator->branch($membership, $request->header('X-Branch-Id'));

        if ($branchId !== null) {
            $this->context->setBranch($branchId);
        }

        return $next($request);
    }
}
