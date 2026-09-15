<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/ingredients/{ingredient}/fork.
 *
 * How a kitchen makes a platform-library row its own so it can edit it — the
 * slice `IngredientCatalogueService::assertWritable()` has been pointing at
 * since the platform/tenant boundary was drawn.
 *
 * A POST sub-resource rather than a `PATCH` that quietly copies on first
 * write, for the same reason `archive` is one (master plan v2 §4.15): forking
 * is a decision with its own audit action and its own consequences — a second
 * row in every search, a divergence from the library — and a kitchen should
 * take it deliberately rather than discover it by having typed in a field.
 *
 * No `If-Match`. The precondition on `update` and `archive` protects a *change
 * to* a row against a concurrent change to the same row; this creates a new
 * row and leaves the source untouched, so there is nothing to be stale about.
 * Repeating the call is safe: the service returns the fork that already exists
 * rather than making a second one, so a retried request is not a duplicate.
 *
 * `201` on the first call and `200` when an existing fork is returned, so a
 * client can tell "I just made this" from "you already had one" without
 * comparing timestamps.
 */
final class IngredientForkController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly IngredientCatalogueService $catalogue,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $ingredient): JsonResponse
    {
        $source = $this->locator->ingredient($ingredient);

        $existing = $this->catalogue->existingFork($source);
        $fork = $this->catalogue->fork($source);
        $fork->load(['defaultUnit', 'purchaseUnit', 'capacityUnit']);

        return ApiResponse::data(
            ['ingredient' => $this->presenter->ingredient($fork)],
            ['created' => $existing === null],
            $existing === null ? 201 : 200,
        )->withHeaders(['ETag' => '"'.$fork->lock_version.'"']);
    }
}
