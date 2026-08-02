<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Http\Requests\ReplaceIngredientAllergensRequest;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\AllergenMappingService;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/ingredients/{ingredient}/allergens.
 *
 * A PUT, not a PATCH, and not a per-row collection: the request body is the
 * complete allergen statement for one market scope, so an omitted class means
 * "not present" and can be acted on. The alternative — a partial merge — makes
 * "removed" and "omitted" the same request, which on an allergen list is the
 * difference between a correction and a silent regression.
 *
 * No `If-Match` here. The precondition guards the ingredient's own
 * `lock_version`; the mapping set is replaced wholesale under the
 * upgrade-only rule, which is itself the safety invariant. Adding a validator
 * that the mapping table does not carry would be theatre.
 */
final class IngredientAllergenReplaceController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly AllergenMappingService $mappings,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceIngredientAllergensRequest $request, string $ingredient): JsonResponse
    {
        $record = $this->locator->ingredient($ingredient);

        $result = $this->mappings->replace($record, $request->marketScope(), $request->mappings());

        return ApiResponse::data(
            $result->map(fn (IngredientAllergen $mapping): array => $this->presenter->mapping($mapping))->all(),
            ['count' => $result->count()],
        );
    }
}
