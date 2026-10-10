<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Illuminate\Database\Eloquent\Builder;

/**
 * The cooked items a kitchen sells with no recipe behind them — what
 * `kitchen:formulate-unlinked` gives a placeholder recipe, and what its
 * `--check` fails on while any is left.
 *
 * **One predicate for both, on purpose.** The run processes exactly this set
 * and the check fails while this set is non-empty, so "the check passes after a
 * run" is true by construction rather than by two lists agreeing.
 *
 * - **The four cooked kinds** — a meal, a sauce, a dressing, a frozen meal. A
 *   resale product is a bought-in good and a plan is a configuration; neither
 *   is a formulation.
 * - **Supplier-mode items included.** A sauce the kitchen buys in is still a
 *   sauce in the recipe book; left out, it would be invisible there for ever.
 *   Its placeholder stays "Not formulated" and its Selling tab already says
 *   "Bought in".
 * - **Retired items excluded.** They are frozen and hidden from the book by
 *   default, and a placeholder written for a withdrawn dish is work nobody will
 *   ever finish.
 *
 * Explicitly organisation-scoped rather than tenant-scoped: the command runs
 * with no user, and the filter is the whole boundary.
 */
final class UnlinkedCookedItems
{
    /**
     * @return Builder<CatalogueItem>
     */
    public static function query(string $organisationId): Builder
    {
        return CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('item_type', RecipeUsageRegistry::KINDS)
            ->whereNull('recipe_id')
            ->where('status', '<>', CatalogueItemStatus::Retired->value);
    }
}
