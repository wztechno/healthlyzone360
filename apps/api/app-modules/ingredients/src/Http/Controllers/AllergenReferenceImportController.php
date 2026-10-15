<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Allergens\AllergenReferenceService;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\AllergenMappingService;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class AllergenReferenceImportController
{
    public function __invoke(Request $request, AllergenReferenceService $references, CatalogueLocator $locator, AllergenMappingService $mappings, IngredientPresenter $presenter, string $ingredient): JsonResponse
    {
        $input = $request->validate([
            'selection_token' => ['required', 'string', 'max:30000'],
            'review_token' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/D'],
            'confirmed' => ['required', 'accepted'],
        ]);
        $record = $locator->ingredient($ingredient);
        // Authorisation/tenancy resolution precedes the external request.
        $reference = $references->resolve($input['selection_token']);
        $record = $mappings->importReference($record, $input['review_token'], $reference);
        $record->load(['defaultUnit', 'purchaseUnit', 'capacityUnit']);

        return ApiResponse::data(['ingredient' => $presenter->ingredient($record, $mappings->mappingsFor($record, $mappings->callerLayer()))]);
    }
}
