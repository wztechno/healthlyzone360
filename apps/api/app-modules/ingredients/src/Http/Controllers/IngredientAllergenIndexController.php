<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\AllergenMappingService;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/ingredients/{ingredient}/allergens.
 *
 * Both layers, in one list, each labelled. A mapping editor that showed only
 * the tenant's overlay would let a kitchen believe an ingredient carries no
 * allergens when the platform baseline says it carries milk.
 */
final class IngredientAllergenIndexController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly AllergenMappingService $mappings,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $ingredient): JsonResponse
    {
        $record = $this->locator->ingredient($ingredient);
        $mappings = $this->mappings->mappingsFor($record, $this->mappings->callerLayer());

        return ApiResponse::data(
            $mappings->map(fn (IngredientAllergen $mapping): array => $this->presenter->mapping($mapping))->all(),
            ['count' => $mappings->count()],
        );
    }
}
