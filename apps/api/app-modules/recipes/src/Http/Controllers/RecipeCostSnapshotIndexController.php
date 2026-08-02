<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Presenters\TechnicalSheetPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/recipes/{recipe}/versions/{version}/cost-snapshots —
 * the cost history of one version, newest first.
 *
 * Paginated where the *version* list is not, and for the opposite reason: a
 * version list is bounded by how many times one kitchen revised one
 * formulation, while a snapshot ledger is append-only and grows every time
 * anybody asks what the recipe costs today. An unbounded list over a ledger is
 * a slow page waiting for a busy kitchen.
 *
 * Newest first because the question is almost always "what does it cost now",
 * and an ascending walk would make the answer the last page. The keyset runs
 * over `(created_at, id)` — when the row was *recorded*, which is the only
 * pair that is both unique and immutable here. `calculated_at` is not: the
 * K1.8 importer can record a sheet dated last spring, and a keyset over a
 * value the importer chooses would let one back-dated import interleave itself
 * into a page a client is halfway through walking.
 *
 * Behind `recipe.view_costs_organisation`.
 */
final class RecipeCostSnapshotIndexController
{
    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly TechnicalSheetPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $query = RecipeCostSnapshot::query()->where('recipe_version_id', $record->getKey());

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: true);

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (RecipeCostSnapshot $snapshot): array => $this->presenter->snapshot($snapshot))->all(),
            $page['meta'],
        );
    }
}
