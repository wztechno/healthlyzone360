<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Services\RecipeListQuery;
use Healthy360\Recipes\Services\RecipeSummaries;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/recipes — the organisation's recipe book.
 *
 * There is no platform library here, unlike ingredients: a recipe belongs to
 * exactly one organisation, always, so the list is simply what this kitchen
 * owns.
 *
 * **What sells a recipe** is part of the book: every row carries `kinds` and
 * `sold_as`, the list filters by `kind` and `selling_status`, and a search
 * finds a recipe by an item's handle or name. All of it is asked of
 * {@see RecipeUsageRegistry}, because recipes never read catalogue tables, and
 * all of it is behind `catalogue.view_organisation` on top of the route's
 * recipe permission: the keys are absent for a reader without it, and the two
 * filters are refused rather than silently ignored.
 */
final class RecipeIndexController
{
    public function __construct(
        private readonly RecipeSummaries $summaries,
        private readonly RecipeListQuery $listQuery,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        // Asked once: the answer decides which filters are allowed, whether a search reaches the
        // sellers, and whether the rows carry them — three places that must not disagree.
        $sellersVisible = $this->summaries->sellersVisible();

        $query = $this->listQuery->filtered($request, $sellersVisible);

        $requestedPage = OffsetPage::page($request);

        if ($requestedPage !== null) {
            $perPage = OffsetPage::perPage($request);
            // Counted before the query is constrained: a constrained builder
            // counts the page rather than the collection.
            $total = $query->toBase()->getCountForPagination();

            OffsetPage::assertWithinRange($requestedPage, $perPage, $total);
            OffsetPage::constrain($query, $requestedPage, $perPage);

            $rows = $query->get();

            return $this->present($rows, OffsetPage::meta($rows, $requestedPage, $perPage, $total), $sellersVisible);
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return $this->present($page['items'], $page['meta'], $sellersVisible);
    }

    /**
     * Present a page of recipes, whichever way it was paginated.
     *
     * Every lookup behind a row — what is live, the current version, its allergens and lines, and
     * what sells it — is one query for the whole page rather than one per row, and lives in
     * {@see RecipeSummaries} so the single-record reads build the identical row.
     *
     * @param  EloquentCollection<int, Recipe>  $recipes
     * @param  array<string, mixed>  $meta
     */
    private function present(EloquentCollection $recipes, array $meta, bool $sellersVisible): JsonResponse
    {
        return ApiResponse::data($this->summaries->page($recipes, $sellersVisible), $meta);
    }
}
