<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Contracts;

use Healthy360\Recipes\Models\Recipe;

/**
 * What else in the platform is selling a recipe.
 *
 * The mirror image of `IngredientUsageRegistry`, one level up and for the same
 * structural reason: the dependency edge runs Catalogues → Recipes, so this
 * module declares the question and the catalogues module answers it.
 * `NullRecipeUsageRegistry` is the answer when nothing sells recipes yet,
 * which keeps K1.2 and K1.3 behaviour intact if the catalogues module is ever
 * removed.
 *
 * One question, and it is a food-safety one. A published meal derives its
 * allergen label from its recipe's published version. Retiring that version
 * while the meal is live would leave a customer reading a label whose basis
 * no longer exists — so the retirement is refused until the item is retired
 * first, exactly as archiving a recipe is refused while it has a published
 * version.
 */
interface RecipeUsageRegistry
{
    /**
     * Identifiers of the **published** catalogue items that sell this recipe.
     *
     * Published only, deliberately. A draft item pointing at a recipe is
     * somebody working on next month's menu, and blocking a retirement on it
     * would make the drafting of a future dish an obstacle to withdrawing a
     * current one. Only a live listing has a customer behind it.
     *
     * @return list<string>
     */
    public function publishedItemIds(Recipe $recipe): array;
}
