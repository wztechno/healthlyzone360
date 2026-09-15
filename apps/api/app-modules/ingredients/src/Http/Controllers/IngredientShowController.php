<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\AllergenMappingService;
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
        private readonly AllergenMappingService $mappings,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $ingredient): JsonResponse
    {
        $record = $this->locator->ingredient($ingredient);
        $record->load(['aliases', 'defaultUnit', 'purchaseUnit', 'capacityUnit']);

        // Carried here as well as on the index so one shape answers both, and
        // so an editor that needs the declaration to render does not have to
        // make a second request and decide what to draw while it is in flight.
        // `/allergens` stays: it is the mapping editor's own resource, and it
        // is what the PUT writes against.
        $mappings = $this->mappings->mappingsFor($record, $this->mappings->callerLayer());

        return ApiResponse::data([
            'ingredient' => $this->presenter->ingredient($record, $mappings),
            'aliases' => $record->aliases->map(fn ($alias): array => $this->presenter->alias($alias))->all(),
        ])->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
