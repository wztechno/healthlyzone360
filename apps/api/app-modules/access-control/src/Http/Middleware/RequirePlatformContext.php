<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Http\Middleware;

use Closure;
use Healthy360\AccessControl\Enums\AccessDenialReason;
use Healthy360\AccessControl\Exceptions\PermissionDenied;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route guard for platform-operator surfaces (alias: platform.context).
 *
 * Stacked after `org.context`, it asserts that the organisation the caller
 * selected is itself of type `platform_operator`. It is deliberately a
 * *second* gate rather than a substitute for a permission check: the
 * permission answers "may this member do this?", this answers "is the
 * workspace they are doing it in the platform at all?". A tenant that somehow
 * held `reference.manage_platform` — through a bespoke role, a mis-seeded
 * template, a future bug — still could not edit the regulatory vocabulary
 * every other tenant depends on, because the organisation *type* is not
 * something a tenant can grant itself.
 *
 * It lives beside `RequirePermission` rather than with the tenancy context
 * middleware because its failure is an authorisation failure and it speaks
 * the access-control vocabulary; tenancy may not depend on access control.
 *
 * The denial reuses `authz.permission_denied` with reason `policy_denied`:
 * the wire vocabulary stays stable, and the message never confirms that the
 * endpoint exists for somebody else.
 */
class RequirePlatformContext
{
    /**
     * The organisation type that owns platform surfaces. Matches the seeded
     * `organisation_types.code`.
     */
    public const string PLATFORM_OPERATOR_TYPE = 'platform_operator';

    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws PermissionDenied
     */
    public function handle(Request $request, Closure $next): Response
    {
        $organisationId = $this->context->organisationId();

        $organisation = $organisationId === null
            ? null
            : Organisation::query()->with('type')->find($organisationId);

        if (! $organisation instanceof Organisation || $organisation->type?->code !== self::PLATFORM_OPERATOR_TYPE) {
            throw new PermissionDenied(AccessDenialReason::PolicyDenied, 'platform.context');
        }

        return $next($request);
    }
}
