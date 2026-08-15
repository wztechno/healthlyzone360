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
