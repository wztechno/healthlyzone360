<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\IngredientBarcodeService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/ingredient-barcodes/scan?code=&symbology= — what a scan
 * says and which ingredient in this kitchen holds it.
 *
 * On `inventory.view_organisation`, because the people scanning are receiving
 * and counting stock. A readable code nobody has linked is a 200 with
 * `link: null`; an unreadable or refused one is `422 barcode.invalid`. A sibling
 * of `/ingredients`, so the path can never be read as an ingredient id.
 */
final class IngredientBarcodeScanController
{
    public function __construct(
        private readonly IngredientBarcodeService $barcodes,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => ['required', 'string', 'max:512'],
            'symbology' => ['nullable', 'string', 'max:32'],
        ]);

        [$scan, $link] = $this->barcodes->resolve($validated['code'], $validated['symbology'] ?? null);

        return ApiResponse::data(['scan' => $this->presenter->scan($scan, $link)]);
    }
}
