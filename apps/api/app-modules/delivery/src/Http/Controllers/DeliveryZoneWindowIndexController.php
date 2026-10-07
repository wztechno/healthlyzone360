<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Services\DeliveryZoneLocator;
use Healthy360\Delivery\Services\ZoneWindowService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/delivery-zones/{zone}/windows — the windows this zone
 * offers, as identifiers in display order, inactive ones included (they stay
 * assigned but are not offered).
 *
 * `ETag` is the **zone's** validator, as on `…/areas`: a zone, its map and its
 * slots are one document.
 */
final class DeliveryZoneWindowIndexController
{
    public function __construct(
        private readonly DeliveryZoneLocator $locator,
        private readonly ZoneWindowService $windows,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $zone): JsonResponse
    {
        $record = $this->locator->zone($zone);

        return ApiResponse::data(['delivery_window_ids' => $this->windows->windowIdsFor($record)])
            ->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
