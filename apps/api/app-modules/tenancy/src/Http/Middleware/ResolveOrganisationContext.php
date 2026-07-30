<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Http\Middleware;

use Closure;
use Healthy360\Tenancy\Exceptions\OrganisationContextForbidden;
use Healthy360\Tenancy\Exceptions\OrganisationContextRequired;
use Healthy360\Tenancy\Services\ContextValidator;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves and validates the X-Organisation-Id header against the
 * authenticated user's memberships (alias: org.context). Client-provided
 * identifiers are never trusted without this server-side validation
 * (plan §9). Fails closed on any doubt.
 *
 * The validation itself lives in ContextValidator, shared with
 * PUT /api/v1/me/context.
 */
class ResolveOrganisationContext
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly ContextValidator $validator,
    ) {}

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

        $membership = $this->validator->membership($user, $organisationId);

        $this->context->setOrganisation(
            (string) $user->getAuthIdentifier(),
            (string) $membership->organisation_id,
            $membership,
        );

        return $next($request);
    }
}
