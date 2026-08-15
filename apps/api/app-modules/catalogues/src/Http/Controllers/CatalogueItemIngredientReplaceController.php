<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\ReplaceCatalogueItemIngredientsRequest;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/items/{item}/ingredients.
 *
 * The public ingredient list — what a diner is told is in the dish, in the
 * order the kitchen chose to name it. Not the formulation: no quantities are
 * accepted here and none are stored.
 */
final class CatalogueItemIngredientReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly CatalogueItemService $items,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceCatalogueItemIngredientsRequest $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $updated = $this->items->setIngredients($record, $request->ingredients(), $this->requiredLockVersion($request));

        $rows = CatalogueItemIngredient::query()
            ->where('catalogue_item_id', $updated->getKey())
            ->orderBy('display_order')
            ->get();

        return ApiResponse::data([
            'item' => $this->presenter->item($updated),
            'ingredients' => $rows->map(fn (CatalogueItemIngredient $row): array => $this->presenter->ingredient($row))->all(),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
