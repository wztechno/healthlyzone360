<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Http\Requests\StoreIngredientAliasRequest;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/ingredients/{ingredient}/aliases.
 */
final class IngredientAliasStoreController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly IngredientCatalogueService $catalogue,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreIngredientAliasRequest $request, string $ingredient): JsonResponse
    {
        $record = $this->locator->ingredient($ingredient);

        $locale = $request->validated('locale');

        $alias = $this->catalogue->addAlias(
            $record,
            (string) $request->validated('alias'),
            is_string($locale) ? $locale : null,
        );

        return ApiResponse::data(['alias' => $this->presenter->alias($alias)], status: 201);
    }
}
