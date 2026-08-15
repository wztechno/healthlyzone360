<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Http\Requests\StoreDeliveryZoneRequest;
use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Delivery\Services\DeliveryZoneService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/delivery-zones.
 *
 * No `If-Match`: nothing existing is written. The zone is created active and
 * covering nowhere — a map with no areas serves nobody, so there is no window
 * in which a half-built zone quotes a delivery.
 */
final class DeliveryZoneStoreController
{
    public function __construct(
        private readonly DeliveryZoneService $zones,
        private readonly DeliveryAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreDeliveryZoneRequest $request): JsonResponse
    {
        $zone = $this->zones->create($request->payload());

        return ApiResponse::data(['delivery_zone' => $this->presenter->zone($zone)], status: 201)
            ->withHeaders(['ETag' => '"'.$zone->lock_version.'"']);
    }
}
