<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/ingredients/{ingredient}.
 *
 * Returns `ETag: "<lock_version>"`. That header is the whole optimistic
 * concurrency contract from the client's side: it reads the resource, keeps
 * the validator, and sends it back as `If-Match` when it writes. Without the
 * ETag a client would have to read `lock_version` out of the body and
 * hand-assemble the header, which is exactly the kind of manual step that
 * gets skipped.
 */
final class IngredientShowController
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
        $record->load('aliases');

        return ApiResponse::data([
            'ingredient' => $this->presenter->ingredient($record),
            'aliases' => $record->aliases->map(fn ($alias): array => $this->presenter->alias($alias))->all(),
        ])->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
