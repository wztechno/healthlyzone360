<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Http\Requests\StoreIngredientRequest;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/ingredients — add an ingredient to the kitchen's
 * own catalogue.
 *
 * The row starts `active` and `unverified`. It is usable immediately, because
 * a kitchen that cannot use what it just typed in will keep a spreadsheet
 * instead; and it is unverified, because nobody has checked it yet and saying
 * otherwise would be a lie the allergen review later depends on.
 */
final class IngredientStoreController
{
    public function __construct(
        private readonly IngredientCatalogueService $catalogue,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreIngredientRequest $request): JsonResponse
    {
        /** @var array{name_en: string, name_ar?: string|null, slug?: string|null, ingredient_category_id?: string|null, ingredient_subcategory_id?: string|null, default_unit_id: string, yield_factor?: float|string|null, availability_tier?: string|null, notes?: string|null} $attributes */
        $attributes = $request->validated();

        $ingredient = $this->catalogue->create($attributes);
        $ingredient->load(['defaultUnit', 'purchaseUnit']);

        return ApiResponse::data(['ingredient' => $this->presenter->ingredient($ingredient)], status: 201)
            ->withHeaders(['ETag' => '"'.$ingredient->lock_version.'"']);
    }
}
