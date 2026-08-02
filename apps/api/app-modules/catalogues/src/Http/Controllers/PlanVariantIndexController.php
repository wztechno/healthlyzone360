<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Catalogues\Services\PlanVariantService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/plans/{item}/variants — the plan's configuration
 * matrix.
 *
 * Each cell carries its coordinates *and* the identity of the variant beneath
 * it: the `catalogue_item_variant_id` a price row points at, the `code` a
 * resubmission matches on, and the `status`. Archived cells are served too, so
 * a grid can render "we used to sell this" differently from "nothing here" —
 * which is what a merchandiser needs to know before trying to open a cell that
 * is already occupied.
 *
 * The `ETag` is the item's, because that is what a PUT to this collection has
 * to carry.
 */
final class PlanVariantIndexController
{
    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanVariantService $variants,
        private readonly PlanAdminPresenter $presenter,
        private readonly CatalogueItemAdminPresenter $items,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $item): JsonResponse
    {
        $plan = $this->locator->plan($item);
        $cells = $this->variants->cellsFor($plan);

        return ApiResponse::data([
            'item' => $this->items->item($plan),
            'cells' => array_map(
                fn (array $cell): array => $this->presenter->cell($cell['profile'], $cell['variant']),
                $cells,
            ),
        ], ['count' => count($cells)])->withHeaders(['ETag' => '"'.$plan->lock_version.'"']);
    }
}
