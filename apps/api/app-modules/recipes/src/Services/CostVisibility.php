<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\Gate;

/**
 * Whether the caller may see money on a recipe.
 *
 * `recipe.view_costs_organisation` is a separate permission from
 * `recipe.view_organisation` on purpose (appendix C): a line cook reading the
 * method to make the dish must not thereby read the margin on it. The
 * technical-sheet and cost-snapshot routes are guarded by the middleware; this
 * service exists for the one place a route guard cannot reach — the **lines**
 * endpoint, which is guarded by `recipe.manage_organisation` and is where cost
 * values enter the system.
 *
 * Two rules, and the second is the one people miss:
 *
 * - Writing a cost requires seeing costs. Somebody who cannot read a unit
 *   price has no way to check the number they are typing, and a blind write is
 *   how a decimal point moves three places.
 * - **Destroying a cost requires seeing costs too.** Lines arrive as a
 *   complete set, so a replacement that omits the cost fields erases whatever
 *   was there. Refusing that is not pedantry: cost data is expensive to
 *   reconstruct, positional line identity means it cannot be re-attached
 *   safely afterwards, and the person doing it would not have been able to see
 *   what they deleted.
 */
final class CostVisibility
{
    public const string PERMISSION = 'recipe.view_costs_organisation';

    /**
     * Routed through the Gate rather than the PermissionChecker directly: the
     * `Gate::before` hook in the access-control module already resolves
     * registered permission codes through the six-step decision, so this stays
     * one implementation of "may they" rather than two.
     */
    public function granted(): bool
    {
        return Gate::allows(self::PERMISSION);
    }

    /**
     * @throws ApiException
     */
    public function assertGranted(string $because): void
    {
        if ($this->granted()) {
            return;
        }

        throw new ApiException(
            ErrorCode::AuthzPermissionDenied,
            $because,
            ['reason' => 'permission_not_granted', 'permission' => self::PERMISSION],
        );
    }
}
