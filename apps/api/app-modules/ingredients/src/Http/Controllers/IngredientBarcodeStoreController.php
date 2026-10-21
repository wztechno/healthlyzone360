<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Http\Requests\StoreIngredientBarcodeRequest;
use Healthy360\Ingredients\Models\IngredientBarcode;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Ingredients\Services\IngredientBarcodeService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/ingredients/{ingredient}/barcodes, and the receiver's
 * POST /api/v1/catalogue/inventory/ingredient-barcodes.
 *
 * Two routes to one controller because the permission middleware takes one code
 * per route: the catalogue route needs `catalogue.manage_organisation`, the dock
 * needs `inventory.manage_organisation`, and a receiver who scans a code nobody
 * has linked links it on the spot. The receiver's route forces the producer's
 * origin (its request refuses `system`). 201 for a new row; 200 when the
 * ingredient already had its kitchen code.
 */
final class IngredientBarcodeStoreController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly IngredientBarcodeService $barcodes,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreIngredientBarcodeRequest $request, ?string $ingredient = null): JsonResponse
    {
        $record = $this->locator->ingredient($ingredient ?? (string) $request->validated('ingredient_id'));
        $quantity = $request->validated('pack_quantity');
        $quantity = $quantity === null ? null : (string) $quantity;
        $unitCode = $request->validated('pack_unit_code');
        $unitCode = is_string($unitCode) ? $unitCode : null;

        if ($request->validated('origin') === IngredientBarcode::ORIGIN_SYSTEM) {
            [$barcode, $created] = $this->barcodes->generate($record, $quantity, $unitCode);
        } else {
            $symbology = $request->validated('symbology');
            $barcode = $this->barcodes->link(
                $record,
                (string) $request->validated('code'),
                is_string($symbology) ? $symbology : null,
                $quantity,
                $unitCode,
                $request->atReceiving(),
            );
            $created = true;
        }

        return ApiResponse::data(['barcode' => $this->presenter->barcode($barcode)], status: $created ? 201 : 200);
    }
}
