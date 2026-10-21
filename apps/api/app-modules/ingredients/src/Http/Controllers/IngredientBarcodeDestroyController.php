<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Models\IngredientBarcode;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Ingredients\Services\IngredientBarcodeService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Symfony\Component\HttpFoundation\Response;

/**
 * DELETE /api/v1/catalogue/ingredients/{ingredient}/barcodes/{barcode}.
 *
 * A real, audited delete. A removed kitchen code's number is never reissued
 * (the counter only climbs), so a label still stuck on a tub scans as "no
 * longer in use" rather than as somebody else's ingredient.
 */
final class IngredientBarcodeDestroyController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly IngredientBarcodeService $barcodes,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $ingredient, string $barcode): Response
    {
        $record = $this->locator->ingredient($ingredient);

        $target = IngredientBarcode::query()
            ->where('ingredient_id', $record->getKey())
            ->whereKey($barcode)
            ->first();

        if (! $target instanceof IngredientBarcode) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $this->barcodes->remove($target);

        return ApiResponse::noContent();
    }
}
