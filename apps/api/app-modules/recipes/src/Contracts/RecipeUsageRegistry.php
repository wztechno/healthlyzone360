<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Contracts;

use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Presenters\RecipeAdminPresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

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
 * first; and archiving the recipe is refused while it has a published version
 * or a live listing, for the same reason one level up. And when a recompute
 * discovers that the label itself has moved underneath a live listing, that
 * listing has to come off sale with it.
 *
 * And a third, which is not a safety question but the recipe book's: **what is
 * this recipe sold as**. The book lists every recipe beside the items selling
 * it, filters by their kind and their sale status, and finds a recipe by an
 * item's handle or name. All three need catalogue rows, so all three are asked
 * here — the SQL lives in the catalogues module and the recipe index only ever
 * calls these methods.
 *
 * @phpstan-import-type RecipeSeller from RecipeAdminPresenter
 */
interface RecipeUsageRegistry
{
    /**
     * The four item types that sell a *formulation* — the cooked kinds. A
     * resale product and a subscription plan are catalogue items too, and
     * neither is a recipe's seller: a product is a bought-in good and a plan
     * is a configuration of other items.
     *
     * @var list<string>
     */
    public const array KINDS = ['meal', 'sauce', 'dressing', 'frozen_meal'];

    /**
     * The kind of a recipe none of the four sells — a marinade, a base, a
     * component another recipe consumes. Derived, never stored.
     */
    public const string PREPARATION = 'preparation';

    /**
     * Identifiers of the **published** catalogue items that sell this recipe,
     * in slug order — what version retirement and recipe archival each refuse
     * on, and name in `details.catalogue_item_ids`.
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

    /**
     * What sells each of these recipes, keyed by recipe id: the items of the
     * four {@see KINDS} whose `recipe_id` names it, in **every** status and in
     * slug order. A recipe nothing sells is absent from the map.
     *
     * Every status, unlike the two questions above, because this one is a
     * listing rather than a guard: a book that forgot a retired sauce would
     * file its recipe as a preparation, and the row, the Kind filter and the
     * item's own page would stop agreeing about what it is.
     *
     * One query for the items and one each for their channels and their packs,
     * however many recipes are asked about — a page, never a row at a time.
     *
     * @param  list<string>  $recipeIds
     * @return array<string, list<RecipeSeller>>
     */
    public function sellersByRecipe(array $recipeIds): array;

    /**
     * Narrow a recipe query to what sells it.
     *
     * `$kind` is one of {@see KINDS} or {@see PREPARATION}; `$sellingStatus` is
     * an item status. A cooked kind keeps the recipes **any** seller of that
     * kind sells — a recipe sold as a meal and as a sauce is listed under both,
     * which is what its row prints. `preparation` keeps the recipes no seller of
     * the four sells. A kind and a status together must hold of **the same
     * seller**: `sauce` + `published` is a recipe with a published sauce, not
     * one with a sauce and some other published item.
     *
     * @param  Builder<Recipe>  $recipes
     */
    public function constrainBySellers(Builder $recipes, ?string $kind, ?string $sellingStatus): void;

    /**
     * Add "…or an item selling it matches" to a recipe search, as one more
     * `OR` inside the caller's grouped search clause: the item's handle
     * (`SAC-016`) or its English name.
     *
     * `$needle` arrives lower-cased, `LIKE`-escaped and wrapped in `%`, exactly
     * as the caller matches its own columns. `$scoped` is that grouped clause
     * of a `recipes` query — typed loosely only because it reaches the caller
     * as a closure's parameter.
     *
     * @param  Builder<covariant Model>  $scoped
     */
    public function orWhereSellerMatches(Builder $scoped, string $needle): void;
}
