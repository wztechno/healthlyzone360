<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
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
        $published = RecipeVersion::query()
            ->whereIn('recipe_id', $recipes->modelKeys())
            ->where('status', RecipeVersionStatus::Published->value)
            ->pluck('version_number', 'recipe_id');

        return ApiResponse::data(
            $recipes->map(fn (Recipe $recipe): array => $this->presenter->recipe(
                $recipe,
                $published->has((string) $recipe->getKey()) ? (int) $published[(string) $recipe->getKey()] : null,
            ))->all(),
            $meta,
        );
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

        if (! is_string($status) || RecipeStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: active, archived.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
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
                        order by
                            case rv.status
                                when ? then 2
                                when ? then 2
                                when ? then 1
                                else 0
                            end desc,
                            rv.version_number desc
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
