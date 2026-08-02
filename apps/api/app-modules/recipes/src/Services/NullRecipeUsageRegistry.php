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
}
