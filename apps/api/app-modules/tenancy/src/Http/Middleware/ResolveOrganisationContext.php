<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Http\Middleware;

use Closure;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\Exceptions\OrganisationContextForbidden;
use Healthy360\Tenancy\Exceptions\OrganisationContextRequired;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves and validates the X-Organisation-Id header against the
 * authenticated user's memberships (alias: org.context). Client-provided
 * identifiers are never trusted without this server-side validation
 * (plan §9). Fails closed on any doubt.
 */
class ResolveOrganisationContext
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws OrganisationContextRequired
     * @throws OrganisationContextForbidden
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user === null) {
            throw new OrganisationContextForbidden;
        }

        $organisationId = $request->header('X-Organisation-Id');

        if (! is_string($organisationId) || trim($organisationId) === '') {
            throw new OrganisationContextRequired;
        }

        if (! Str::isUuid($organisationId)) {
            throw new OrganisationContextForbidden;
        }

        $membership = OrganisationMembership::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('user_id', $user->getAuthIdentifier())
            ->where('status', MembershipStatus::Active)
            ->first();

        if ($membership === null) {
            throw new OrganisationContextForbidden;
        }

        $this->context->setOrganisation((string) $user->getAuthIdentifier(), $organisationId, $membership);

        return $next($request);
    }
}
