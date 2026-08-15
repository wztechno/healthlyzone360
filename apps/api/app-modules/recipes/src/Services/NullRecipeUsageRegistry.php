<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Models\Recipe;

/**
 * The answer when nothing sells recipes: nobody is.
 *
 * Bound by `RecipesServiceProvider` and replaced by the catalogues module's
 * implementation when that module is present. The null object exists so the
 * recipe lifecycle keeps working — and keeps being testable — without the
 * modules above it, rather than resolving to an unbound interface and failing
 * at the container.
 */
final class NullRecipeUsageRegistry implements RecipeUsageRegistry
{
    /**
     * @return list<string>
     */
    public function publishedItemIds(Recipe $recipe): array
    {
        return [];
    }

    /**
     * Nothing sells this recipe, so nothing comes off sale. The recompute job
     * still calls it — a quarantine that only happened when the catalogues
     * module was installed would be a quarantine with a hole in it — and the
     * empty answer is the honest one here.
     *
     * @return list<string>
     */
    public function quarantinePublishedItems(Recipe $recipe, string $reason): array
    {
        return [];
    }
}
