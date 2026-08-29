<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Http\Middleware\RequirePrecondition;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/ingredients/{ingredient}/archive.
 *
 * A lifecycle action as a POST sub-resource, never `PATCH status` (master
 * plan v2 §4.15): archiving is a decision with its own audit action and — in
 * later slices — its own permission and its own readiness consequences, none
 * of which a generic field update could carry.
 *
 * There is no delete. An ingredient that has ever appeared in a recipe is
 * part of a food-safety record.
 */
final class IngredientArchiveController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly IngredientCatalogueService $catalogue,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $ingredient): JsonResponse
    {
        $record = $this->locator->ingredient($ingredient);
        $this->catalogue->assertWritable($record);

        $expected = RequirePrecondition::lockVersion($request);

        if ($expected === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The If-Match header must carry the ETag this resource was last served with.',
                ['required_headers' => ['If-Match']],
            );
        }

        $archived = $this->catalogue->archive($record, $expected);
        $archived->load(['defaultUnit', 'purchaseUnit']);

        return ApiResponse::data(['ingredient' => $this->presenter->ingredient($archived)])
            ->withHeaders(['ETag' => '"'.$archived->lock_version.'"']);
    }
}
