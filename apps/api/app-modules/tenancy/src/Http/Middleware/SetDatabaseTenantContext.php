<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Http\Middleware;

use Closure;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Publishes the authenticated identity to the database session and takes it
 * back down again when the response has been sent (alias: db.context).
 *
 * It sits immediately after `auth:sanctum`, before organisation resolution,
 * because two policies depend only on the user: a person's own memberships
 * (GET /api/v1/me) and their own consent grants. The organisation and branch
 * settings are *not* set here — TenantContext republishes itself on every
 * mutation, so ResolveOrganisationContext, ResolveBranchContext and the
 * services that resolve a remembered context deep inside /me all reach the
 * database session by themselves. Registering this middleware a second time
 * after org.context would in any case be discarded: Laravel de-duplicates
 * middleware names when it gathers a route's stack.
 *
 * The reset is terminable rather than inline so it runs after the response is
 * on the wire, and it always runs — a worker or FPM process that reuses this
 * connection must never inherit the previous request's tenant.
 */
final class SetDatabaseTenantContext
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user !== null && ! $this->context->hasOrganisation()) {
            $this->context->setUser((string) $user->getAuthIdentifier());
        }

        return $next($request);
    }

    public function terminate(Request $request, Response $response): void
    {
        $this->context->clear();
    }
}
