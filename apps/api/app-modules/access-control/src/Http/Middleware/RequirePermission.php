<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Http\Middleware;

use App\Models\User;
use Closure;
use Healthy360\AccessControl\Exceptions\PermissionDenied;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route guard for a registered permission code (alias: permission).
 *
 * Stacked after org.context so the six-step decision runs against a
 * server-validated tenant context. Resource-level checks (steps 5 and 6)
 * stay in policies; this middleware answers "may this member do this at all
 * in this organisation?" and reports the exact denying step.
 */
class RequirePermission
{
    public function __construct(
        private readonly PermissionChecker $checker,
        private readonly TenantContext $context,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws PermissionDenied
     */
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        if (! PermissionRegistry::isPermissionCode($permission)) {
            throw new InvalidArgumentException("[{$permission}] is not a registered Healthy360 permission code.");
        }

        $user = $request->user();

        $decision = $this->checker->check(
            $user instanceof User ? $user : null,
            $permission,
            null,
            $this->context,
        );

        // A decision always carries exactly one reason when it denies, so the
        // reason itself is the denial signal.
        if ($decision->denialReason !== null) {
            throw new PermissionDenied($decision->denialReason, $permission);
        }

        return $next($request);
    }
}
