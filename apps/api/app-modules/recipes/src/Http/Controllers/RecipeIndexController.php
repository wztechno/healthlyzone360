<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Presenters\RecipeAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/recipes — the organisation's recipe book.
 *
 * There is no platform library here, unlike ingredients: a recipe belongs to
 * exactly one organisation, always, so the list is simply what this kitchen
 * owns.
 */
final class RecipeIndexController
{
    private const string STATUS_FILTER_MESSAGE = 'The status filter must be one of: active, archived, draft, review_required, published, retired.';

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
     * Written unqualified so a caller can prefix the columns for its own alias — see the three
     * `str_replace` call sites, each of which needs a different one.
     */
    private const string CURRENT_VERSION_ORDER = 'case status when ? then 2 when ? then 2 when ? then 1 else 0 end desc, version_number desc';

    public function __construct(private readonly RecipeAdminPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = Recipe::query();

        $this->applyStatus($request, $query);
        $this->applyCategory($request, $query);
        $this->applySearch($request, $query);
        $this->applyAllergen($request, $query);
        $this->applyStaleOnly($request, $query);

        $requestedPage = OffsetPage::page($request);

        if ($requestedPage !== null) {
            $perPage = OffsetPage::perPage($request);
            // Counted before the query is constrained: a constrained builder
            // counts the page rather than the collection.
            $total = $query->toBase()->getCountForPagination();

            OffsetPage::assertWithinRange($requestedPage, $perPage, $total);
            OffsetPage::constrain($query, $requestedPage, $perPage);

            $rows = $query->get();

            return $this->present($rows, OffsetPage::meta($rows, $requestedPage, $perPage, $total));
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return $this->present($page['items'], $page['meta']);
    }

    /**
     * Present a page of recipes, whichever way it was paginated.
     *
     * The published-version lookup is one query for the whole page rather than
     * one per row: "what is live" is the first thing a list is read for, and an
     * N+1 on the recipe book is the kind of thing that only hurts once the
     * kitchen is busy.
     *
     * @param  EloquentCollection<int, Recipe>  $recipes
     * @param  array<string, mixed>  $meta
     */
    private function present(EloquentCollection $recipes, array $meta): JsonResponse
    {
        /** @var list<string> $recipeIds */
        $recipeIds = $recipes->map(static fn (Recipe $recipe): string => (string) $recipe->getKey())->values()->all();

        $published = RecipeVersion::query()
            ->whereIn('recipe_id', $recipeIds)
            ->where('status', RecipeVersionStatus::Published->value)
            ->pluck('version_number', 'recipe_id');

        $current = $this->currentVersions($recipeIds);
        $allergens = $this->allergenCodes($current);

        return ApiResponse::data(
            $recipes->map(function (Recipe $recipe) use ($published, $current, $allergens): array {
                $key = (string) $recipe->getKey();
                $version = $current[$key] ?? null;

                return $this->presenter->recipe(
                    $recipe,
                    $published->has($key) ? (int) $published[$key] : null,
                    $version?->status->value,
                    $version === null ? [] : ($allergens[(string) $version->getKey()] ?? []),
                );
            })->all(),
            $meta,
        );
    }

    /**
     * The one version each recipe on this page is "currently" showing, keyed by recipe id.
     *
     * Same precedence as {@see applyAllergen()} selects on, and as the client applies when it opens
     * a record: an editable version first (draft or review_required), then the published one, then
     * the highest numbered. Those three had drifted apart once already — the column said one
     * version's allergens while the filter narrowed by another's — so the ordering lives in
     * {@see CURRENT_VERSION_ORDER} and both readers name it.
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

        $versionIds = array_map(static fn (RecipeVersion $v): string => (string) $v->getKey(), array_values($current));

        $codes = [];

        foreach (
            RecipeVersionAllergen::query()
                ->whereIn('recipe_version_id', $versionIds)
                ->orderBy('allergen_code')
                ->get(['recipe_version_id', 'allergen_code']) as $row
        ) {
            $codes[(string) $row->recipe_version_id][] = (string) $row->allergen_code;
        }

        return $codes;
    }

    /**
     * Archived recipes are excluded unless asked for by name — the same rule
     * the ingredient list applies, and for the same reason.
     *
     * @param  Builder<Recipe>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            $query->where('status', RecipeStatus::Active->value);

            return;
        }

        if (! is_string($status)) {
            throw new ApiException(ErrorCode::RequestInvalid, self::STATUS_FILTER_MESSAGE, ['parameter' => 'status']);
        }

        if (RecipeStatus::tryFrom($status) !== null) {
            $query->where('status', $status);

            return;
        }

        /*
         * A version state, not a recipe state.
         *
         * The recipe row carries `active | archived`; everything a reader actually filters by —
         * draft, review_required, published — lives on the version. The client used to translate
         * as best it could (published → active, retired → archived) and **drop draft and
         * review_required on the floor**, so picking either sent an unfiltered request and the list
         * answered with everything. That was invisible before a quarantine existed and is not
         * invisible now.
         *
         * Narrowed against the *current* version, for the same reason the Allergens filter is: the
         * status the row displays and the status the filter matches have to be the same one.
         */
        $versionStatus = RecipeVersionStatus::tryFrom($status);

        if ($versionStatus === null) {
            throw new ApiException(ErrorCode::RequestInvalid, self::STATUS_FILTER_MESSAGE, ['parameter' => 'status']);
        }

        if ($versionStatus === RecipeVersionStatus::Retired) {
            $query->where('status', RecipeStatus::Archived->value);

            return;
        }

        $query->where('status', RecipeStatus::Active->value)
            ->whereExists(function ($sub) use ($versionStatus): void {
                $sub->selectRaw('1')
                    ->from('recipe_versions as rv')
                    ->whereColumn('rv.recipe_id', 'recipes.id')
                    ->where('rv.status', $versionStatus->value)
                    ->whereRaw(
                        'rv.id = (
                            select inner_rv.id
                            from recipe_versions as inner_rv
                            where inner_rv.recipe_id = recipes.id
                            order by '.str_replace(
                            ['status', 'version_number'],
                            ['inner_rv.status', 'inner_rv.version_number'],
                            self::CURRENT_VERSION_ORDER,
                        ).'
                            limit 1
                        )',
                        [
                            RecipeVersionStatus::Draft->value,
                            RecipeVersionStatus::ReviewRequired->value,
                            RecipeVersionStatus::Published->value,
                        ],
                    );
            });
    }

    /**
     * @param  Builder<Recipe>  $query
     */
    private function applyCategory(Request $request, Builder $query): void
    {
        $category = $request->query('category');

        if (! is_string($category) || $category === '') {
            return;
        }

        $query->where('recipe_category', $category);
    }

    /**
     * @param  Builder<Recipe>  $query
     */
    private function applySearch(Request $request, Builder $query): void
    {
        $term = $request->query('query');

        if (! is_string($term) || trim($term) === '') {
            return;
        }

        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->where(function (Builder $scoped) use ($needle): void {
            $scoped->whereRaw('lower(name_en) like ?', [$needle])
                ->orWhereRaw('lower(name_ar) like ?', [$needle])
                ->orWhereRaw('lower(slug) like ?', [$needle]);
        });
    }

    /**
     * Narrows to the recipes whose current version declares one allergen class.
     *
     * **Against the current version, not every version the recipe has ever had.** A recipe that
     * carried sesame at v1 and had it formulated out by v4 is not a sesame recipe, and a filter
     * matching any version would keep returning it — worse, it would return it while the row's own
     * Allergens cell, which reads the current version, showed no sesame. The list would be
     * disagreeing with itself on screen, which is the failure mode this filter exists to avoid.
     *
     * **Current is the client's rule, in SQL.** `pickCurrentRecipeVersion` prefers the highest
     * editable version — draft or review-required — then the published one, then the highest
     * number there is. That ordering is reproduced here rather than approximated, because the
     * column and the filter have to be reading the same version or the disagreement above comes
     * back through the other door. It differs from `applyStaleOnly`'s simpler "highest of the
     * three": that one is answering a question about the review queue, where any open version
     * carrying a stale derivation is worth surfacing, and the two are allowed to differ because
     * they are not answering the same question.
     *
     * **Both containments match**, the same call the ingredient list makes and for the same
     * reason: the Allergens column prints `contains` and `may_contain` alike, so a row reading
     * `gluten` that a `gluten` filter did not return would be the list disagreeing with itself.
     * It is also the safe direction — somebody narrowing by an allergen wants everything that
     * could carry it, and dropping the `may_contain` rows would answer a food-safety question by
     * under-reporting.
     *
     * **Declared rows match too.** A chef's `declared` row is the strongest claim on the label —
     * a human who knows the fryer is shared — so a filter that only matched `derived` would hide
     * exactly the warnings somebody has taken the trouble to write down.
     *
     * Filtered here rather than in the client because the recipe book is paged: a filter applied
     * to the loaded page narrows that page while the count and every page after it go on
     * describing the unfiltered set.
     *
     * @param  Builder<Recipe>  $query
     */
    private function applyAllergen(Request $request, Builder $query): void
    {
        $allergen = $request->query('allergen');

        if (! is_string($allergen) || $allergen === '') {
            return;
        }

        $query->whereExists(function ($sub) use ($allergen): void {
            $sub->selectRaw('1')
                ->from('recipe_version_allergens')
                ->where('recipe_version_allergens.allergen_code', $allergen)
                ->whereRaw(
                    'recipe_version_allergens.recipe_version_id = (
                        select rv.id
                        from recipe_versions as rv
                        where rv.recipe_id = recipes.id
                        order by '.str_replace(
                        ['status', 'version_number'],
                        ['rv.status', 'rv.version_number'],
                        self::CURRENT_VERSION_ORDER,
                    ).'
                        limit 1
                    )',
                    [
                        RecipeVersionStatus::Draft->value,
                        RecipeVersionStatus::ReviewRequired->value,
                        RecipeVersionStatus::Published->value,
                    ],
                );
        });
    }

    /**
     * When `stale_only` is true, keep recipes whose editable or live version
     * still carries a stale allergen derivation. Used by the kitchen review queue.
     *
     * @param  Builder<Recipe>  $query
     */
    private function applyStaleOnly(Request $request, Builder $query): void
    {
        if (! $request->boolean('stale_only')) {
            return;
        }

        $editableStatuses = [
            RecipeVersionStatus::Draft->value,
            RecipeVersionStatus::ReviewRequired->value,
            RecipeVersionStatus::Published->value,
        ];

        $query->whereExists(function ($sub) use ($editableStatuses): void {
            $sub->selectRaw('1')
                ->from('recipe_versions as current_version')
                ->whereColumn('current_version.recipe_id', 'recipes.id')
                ->whereIn('current_version.status', $editableStatuses)
                ->where('current_version.derivation_state', DerivationState::Stale->value)
                ->whereRaw(
                    'current_version.version_number = (
                        select max(rv.version_number)
                        from recipe_versions as rv
                        where rv.recipe_id = recipes.id
                          and rv.status in (?, ?, ?)
                    )',
                    $editableStatuses,
                );
        });
    }
}
