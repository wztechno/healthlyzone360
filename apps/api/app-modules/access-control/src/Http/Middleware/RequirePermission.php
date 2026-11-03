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
 *
 * `permission:a,b` passes on either code. The kitchen display is the reason: the
 * wall's buttons are reachable by a cashier on `order.manage_organisation` and by
 * a cook on `order.prepare_organisation`, and neither code contains the other.
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
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();
        $denied = null;

        foreach ($permissions as $permission) {
            if (! PermissionRegistry::isPermissionCode($permission)) {
                throw new InvalidArgumentException("[{$permission}] is not a registered Healthy360 permission code.");
            }

            $decision = $this->checker->check(
                $user instanceof User ? $user : null,
                $permission,
                null,
                $this->context,
            );

            // A decision always carries exactly one reason when it denies, so the
            // reason itself is the denial signal.
            if ($decision->denialReason === null) {
                return $next($request);
            }

            $denied ??= new PermissionDenied($decision->denialReason, $permission);
        }

        throw $denied ?? new InvalidArgumentException('The permission middleware names no code.');
    }
}
