<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Models\Ingredient;

/**
 * The answer when nothing downstream of ingredients is installed: nobody is
 * using anything, and no label can be stale because no label exists.
 *
 * Bound by `IngredientsServiceProvider` and replaced by the recipes module's
 * implementation when that module is present. The null object exists so the
 * ingredient catalogue keeps working — and keeps being testable — without the
 * modules above it, rather than resolving to an unbound interface and failing
 * at the container.
 */
final class NullIngredientUsageRegistry implements IngredientUsageRegistry
{
    /**
     * @return array{recipe_ids: list<string>, recipe_version_ids: list<string>, catalogue_item_ids: list<string>}
     */
    public function activeReferences(Ingredient $ingredient): array
    {
        return ['recipe_ids' => [], 'recipe_version_ids' => [], 'catalogue_item_ids' => []];
    }

    /**
     * @return list<string>
     */
    public function markDependentDerivationsStale(Ingredient $ingredient): array
    {
        return [];
    }

    /**
     * @return list<string>
     */
    public function dependentOrganisationIds(Ingredient $ingredient): array
    {
        return [];
    }
}
