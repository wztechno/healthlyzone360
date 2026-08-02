<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Delivery\Services\DeliveryZoneLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/delivery-zones/{zone}.
 *
 * Returns `ETag: "<lock_version>"` — the client's half of the
 * optimistic-concurrency contract. The **area set is versioned against this
 * same number**: a zone and its map are one document, and two operators
 * redrawing at once is exactly the race the validator catches.
 *
 * `meta.area_count` comes with it so a client can render "17 areas" without
 * fetching them, while the areas themselves stay behind `…/areas` — a zone can
 * name a hundred places and a show endpoint that embedded them would make the
 * common read the expensive one.
 */
final class DeliveryZoneShowController
{
    public function __construct(
        private readonly DeliveryZoneLocator $locator,
        private readonly DeliveryAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $zone): JsonResponse
    {
        $record = $this->locator->zone($zone);

        $areaCount = DeliveryZoneArea::query()->where('delivery_zone_id', $record->getKey())->count();

        return ApiResponse::data(
            ['delivery_zone' => $this->presenter->zone($record)],
            ['area_count' => $areaCount],
        )->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
