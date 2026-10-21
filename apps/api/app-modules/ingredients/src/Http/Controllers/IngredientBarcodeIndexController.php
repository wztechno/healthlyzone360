<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Models\IngredientBarcode;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/ingredients/{ingredient}/barcodes — this kitchen's
 * codes for the ingredient, oldest first.
 */
final class IngredientBarcodeIndexController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $ingredient): JsonResponse
    {
        $record = $this->locator->ingredient($ingredient);

        $barcodes = IngredientBarcode::query()
            ->with('packUnit')
            ->where('ingredient_id', $record->getKey())
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        return ApiResponse::data(
            $barcodes->map(fn (IngredientBarcode $barcode): array => $this->presenter->barcode($barcode))->all(),
            ['count' => $barcodes->count()],
        );
    }
}
