<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Http\Controllers\RecipeIndexController;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Presenters\RecipeAdminPresenter;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Every `AdminRecipe` the API serves, built one way — for a page of the recipe book or for one
 * recipe on its own.
 *
 * The list and the single-record reads used to build the row separately, and drifted: the show,
 * create, update and archive responses sent `current_version_status: null` and no allergen codes
 * while the list sent both, so a recipe could say one thing on its own page and another in the list
 * it was opened from. Now there is one builder and {@see one()} is a page of one.
 *
 * **Seven queries a page, whatever its size**: the published versions, the current versions, their
 * allergen codes, their line counts, and — when the reader may see them — the items selling each
 * recipe with those items' channels and packs, asked of {@see RecipeUsageRegistry} because recipes
 * never read catalogue tables. Never a query per row: what a list is read for is what it has to be
 * able to answer for twenty-five rows at once.
 *
 * @phpstan-import-type AdminRecipeRow from RecipeAdminPresenter
 */
final readonly class RecipeSummaries
{
    /**
     * What a reader needs to see the items selling a recipe. Recipe view alone shows the book —
     * a chef reads formulations — and the catalogue is somebody else's page.
     */
    public const string SELLERS_PERMISSION = 'catalogue.view_organisation';

    /**
     * "Which version is this recipe currently showing?", as an ORDER BY fragment.
     *
     * Takes three bindings, in this order: draft, review_required, published. An editable version
     * outranks the published one — a kitchen looking at its book wants the revision in progress —
     * and version number breaks the remaining ties.
     *
     * One definition because there are four readers that must agree: the Allergens column, the
     * Allergens *filter*, the Status filter, and the client's own `pickCurrentRecipeVersion`. When
     * two of them disagreed, a row could be hidden by a filter its own visible cell said it matched.
     *
     * Written unqualified so a caller can prefix the columns for its own alias — see the
     * `str_replace` call sites in {@see RecipeIndexController}, each of which needs a different one.
     */
    public const string CURRENT_VERSION_ORDER = 'case status when ? then 2 when ? then 2 when ? then 1 else 0 end desc, version_number desc';

    public function __construct(
        private RecipeAdminPresenter $presenter,
        private RecipeUsageRegistry $usage,
    ) {}

    /**
     * Whether this reader sees `kinds` and `sold_as`, and may filter by them.
     *
     * Routed through the Gate rather than the PermissionChecker directly, for the reason
     * `CostVisibility` gives: the access-control module's `Gate::before` already resolves
     * registered permission codes, so this stays one implementation of "may they".
     */
    public function sellersVisible(): bool
    {
        return Gate::allows(self::SELLERS_PERMISSION);
    }

    /**
     * The rows for a page of recipes, in the page's own order.
     *
     * `$withSellers` is the caller's {@see sellersVisible()}, asked once for the request: the index
     * needs the answer before it has a page, to decide whether a seller filter is allowed at all.
     *
     * @param  EloquentCollection<int, Recipe>  $recipes
     * @return list<AdminRecipeRow>
     */
    public function page(EloquentCollection $recipes, bool $withSellers): array
    {
        $recipeIds = [];

        foreach ($recipes as $recipe) {
            $recipeIds[] = (string) $recipe->getKey();
        }

        $published = $this->publishedVersionNumbers($recipeIds);
        $current = $this->currentVersions($recipeIds);
        $allergens = $this->allergenCodes($current);
        $lineCounts = $this->lineCounts($current);
        $sellers = $withSellers ? $this->usage->sellersByRecipe($recipeIds) : null;

        $rows = [];

        foreach ($recipes as $recipe) {
            $key = (string) $recipe->getKey();
            $version = $current[$key] ?? null;
            $versionKey = $version === null ? null : (string) $version->getKey();

            $rows[] = $this->presenter->recipe(
                $recipe,
                $published[$key] ?? null,
                $version?->status->value,
                $versionKey === null ? [] : ($allergens[$versionKey] ?? []),
                $versionKey === null ? 0 : ($lineCounts[$versionKey] ?? 0),
                $sellers === null ? null : ($sellers[$key] ?? []),
            );
        }

        return $rows;
    }

    /**
     * One recipe's row, exactly as the list would draw it — for the single-record read and for
     * every write's response.
     *
     * @return AdminRecipeRow
     */
    public function one(Recipe $recipe): array
    {
        return $this->page(new EloquentCollection([$recipe]), $this->sellersVisible())[0];
    }

    /**
     * The live version's number for each recipe that has one, keyed by recipe id.
     *
     * @param  list<string>  $recipeIds
     * @return array<string, int>
     */
    private function publishedVersionNumbers(array $recipeIds): array
    {
        if ($recipeIds === []) {
            return [];
        }

        $numbers = [];

        foreach (
            RecipeVersion::query()
                ->whereIn('recipe_id', $recipeIds)
                ->where('status', RecipeVersionStatus::Published->value)
                ->get(['recipe_id', 'version_number']) as $version
        ) {
            $numbers[(string) $version->recipe_id] = $version->version_number;
        }

        return $numbers;
    }

    /**
     * The one version each recipe on this page is "currently" showing, keyed by recipe id.
     *
     * Same precedence as the index's allergen filter selects on, and as the client applies when it
     * opens a record: an editable version first (draft or review_required), then the published one,
     * then the highest numbered. Those three had drifted apart once already — the column said one
     * version's allergens while the filter narrowed by another's — so the ordering lives in
     * {@see CURRENT_VERSION_ORDER} and every reader names it.
     *
     * `DISTINCT ON` rather than a window function or a correlated subquery: PostgreSQL will take
     * the first row per `recipe_id` in one pass over the same ordering, which is exactly the
     * question being asked.
     *
     * @param  list<string>  $recipeIds
     * @return array<string, RecipeVersion>
     */
    private function currentVersions(array $recipeIds): array
    {
        if ($recipeIds === []) {
            return [];
        }

        /** @var EloquentCollection<int, RecipeVersion> $versions */
        $versions = RecipeVersion::query()
            ->select('*')
            ->distinct('recipe_id')
            ->whereIn('recipe_id', $recipeIds)
            ->orderByRaw('recipe_id, '.self::CURRENT_VERSION_ORDER, [
                RecipeVersionStatus::Draft->value,
                RecipeVersionStatus::ReviewRequired->value,
                RecipeVersionStatus::Published->value,
            ])
            ->get();

        $byRecipe = [];

        foreach ($versions as $version) {
            $byRecipe[(string) $version->recipe_id] ??= $version;
        }

        return $byRecipe;
    }

    /**
     * The allergen codes each of those versions declares, keyed by version id.
     *
     * @param  array<string, RecipeVersion>  $current
     * @return array<string, list<string>>
     */
    private function allergenCodes(array $current): array
    {
        if ($current === []) {
            return [];
        }

        $codes = [];

        foreach (
            RecipeVersionAllergen::query()
                ->whereIn('recipe_version_id', self::versionIds($current))
                ->orderBy('allergen_code')
                ->get(['recipe_version_id', 'allergen_code']) as $row
        ) {
            $codes[(string) $row->recipe_version_id][] = (string) $row->allergen_code;
        }

        return $codes;
    }

    /**
     * How many lines each of those versions holds, keyed by version id — one grouped count for the
     * page. A version with none is absent, and reads as zero.
     *
     * @param  array<string, RecipeVersion>  $current
     * @return array<string, int>
     */
    private function lineCounts(array $current): array
    {
        if ($current === []) {
            return [];
        }

        $counts = [];

        foreach (
            RecipeVersionLine::query()
                ->whereIn('recipe_version_id', self::versionIds($current))
                ->groupBy('recipe_version_id')
                ->selectRaw('recipe_version_id, count(*) as line_count')
                ->toBase()
                ->get() as $row
        ) {
            $counts[(string) $row->recipe_version_id] = (int) $row->line_count;
        }

        return $counts;
    }

    /**
     * @param  array<string, RecipeVersion>  $current
     * @return list<string>
     */
    private static function versionIds(array $current): array
    {
        return array_values(array_map(static fn (RecipeVersion $version): string => (string) $version->getKey(), $current));
    }
}
