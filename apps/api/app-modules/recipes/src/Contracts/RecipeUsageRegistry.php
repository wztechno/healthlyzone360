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
 * Two questions, and both are food-safety ones. A published meal derives its
 * allergen label from its recipe's published version. Retiring that version
 * while the meal is live would leave a customer reading a label whose basis
 * no longer exists — so the retirement is refused until the item is retired
 * first, exactly as archiving a recipe is refused while it has a published
 * version. And when a recompute discovers that the label itself has moved
 * underneath a live listing, that listing has to come off sale with it.
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

    /**
     * Pull every published listing of this recipe off sale and into
     * `review_required`, returning what was moved (K1.8).
     *
     * The propagation half of the allergen quarantine. When the reactive
     * recompute finds that a published version's frozen label has changed, the
     * version is quarantined — but the listing in front of a customer is a
     * separate row with a separate status, and leaving it `published` would
     * keep serving a dish whose allergen basis is under review. The quarantine
     * has to travel the same edge the label travels.
     *
     * Asked through this port rather than by the recipes module touching
     * catalogue tables, for the reason the port exists: the dependency edge runs
     * Catalogues → Recipes, and recipes must not learn that catalogues exist.
     *
     * The implementation owns its own audit trail — it is the only party that
     * knows which listings it moved — and is expected to record
     * `catalogue.item_quarantined` per item.
     *
     * @param  string  $reason  a plain sentence for `review_reason`, already
     *                          fitted to the column
     * @return list<string> the items moved; empty when nothing was published
     */
    public function quarantinePublishedItems(Recipe $recipe, string $reason): array;
}
