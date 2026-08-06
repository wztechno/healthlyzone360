<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Http\Middleware;

use Closure;
use Healthy360\Organisations\Services\OrganisationTradingGuard;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The selected organisation must still be trading (alias: `org.trading`, PA1).
 *
 * ## Why this is a route middleware and not a step in `PermissionChecker`
 *
 * Suspension takes a tenant's *ability to sell* away, not its ability to look
 * at itself. A kitchen the platform has suspended keeps signing in, keeps
 * reading its recipes, its orders and its ops screens, and — most importantly
 * — keeps being able to see the suspension banner explaining why the publish
 * button now refuses. Folding the check into the six-step permission decision
 * would have made every read fail too, and a tenant locked out entirely cannot
 * be told anything.
 *
 * Declaring it per route group is what makes the read/write line *visible*.
 * `api-v1.php` already splits the kitchen surface by permission code, so
 * adding this alias beside `permission:catalogue.manage_organisation` and its
 * siblings puts the rule where somebody reviewing the routes will read it,
 * rather than in a registry of "which permission codes are mutating" that
 * would have to be kept in step by hand.
 *
 * ## Why it is not applied to day-to-day operations
 *
 * Inventory counts, production runs, the kitchen display and quality checks
 * are deliberately left open. Suspension stops a kitchen selling; it does not
 * stop it finishing the food it already owes people, and a stock count that
 * refuses is a stock count that gets written on paper instead.
 *
 * Runs after `org.context`, which is what puts an organisation in the context
 * to check. No context means nothing to refuse, and the guard passes — the
 * routes that need one already say `org.context` themselves.
 */
class RequireTradingOrganisation
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly OrganisationTradingGuard $guard,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws ApiException
     */
    public function handle(Request $request, Closure $next): Response
    {
        $this->guard->assertTrading($this->context->organisationId());

        return $next($request);
    }
}
