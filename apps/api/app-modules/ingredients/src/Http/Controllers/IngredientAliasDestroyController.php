<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Symfony\Component\HttpFoundation\Response;

/**
 * DELETE /api/v1/catalogue/ingredients/{ingredient}/aliases/{alias}.
 *
 * A real delete, unlike almost everything else in the catalogue: an alias is
 * a lookup convenience, not a food-safety record, and a wrong one left in
 * place actively misroutes a designation. The removal is audited, so the
 * decision is still traceable.
 */
final class IngredientAliasDestroyController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly IngredientCatalogueService $catalogue,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $ingredient, string $alias): Response
    {
        $record = $this->locator->ingredient($ingredient);
        $target = $this->locator->alias($record, $alias);

        $this->catalogue->removeAlias($record, $target);

        return ApiResponse::noContent();
    }
}
