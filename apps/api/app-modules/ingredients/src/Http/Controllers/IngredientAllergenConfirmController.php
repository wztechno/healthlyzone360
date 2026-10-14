<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\AllergenMappingService;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final readonly class IngredientAllergenConfirmController
{
    public function __construct(private CatalogueLocator $locator, private AllergenMappingService $mappings, private IngredientPresenter $presenter) {}

    public function __invoke(Request $request, string $ingredient): JsonResponse
    {
        $values = $request->validate([
            'review_token' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/D'],
            'evidence' => ['required', 'string', 'max:2000'],
            'supplier_evidence' => ['nullable', 'string', 'max:2000'],
            'confirm_no_allergens' => ['sometimes', 'boolean'],
        ]);
        $record = $this->mappings->confirm($this->locator->ingredient($ingredient), $values['review_token'], $values['evidence'], $values['supplier_evidence'] ?? null, (bool) ($values['confirm_no_allergens'] ?? false));
        $record->load(['defaultUnit', 'purchaseUnit', 'capacityUnit']);
        $mappings = $this->mappings->mappingsFor($record, $this->mappings->callerLayer());

        return ApiResponse::data(['ingredient' => $this->presenter->ingredient($record, $mappings)]);
    }
}
