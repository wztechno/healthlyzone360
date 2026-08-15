<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/ingredients/{ingredient}/aliases.
 */
final class IngredientAliasIndexController
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

        $aliases = IngredientAlias::query()
            ->where('ingredient_id', $record->getKey())
            ->orderBy('alias_normalised')
            ->get();

        return ApiResponse::data(
            $aliases->map(fn (IngredientAlias $alias): array => $this->presenter->alias($alias))->all(),
            ['count' => $aliases->count()],
        );
    }
}
