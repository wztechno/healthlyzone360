<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Http\Concerns\ReadsPrecondition;
use Healthy360\Delivery\Http\Requests\UpdateDeliveryZoneRequest;
use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Delivery\Services\DeliveryZoneLocator;
use Healthy360\Delivery\Services\DeliveryZoneService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/delivery-zones/{zone} — behind `precondition`.
 *
 * Renames, reprices and suspends. It does not change the code, and a request
 * carrying one is refused rather than ignored.
 *
 * Changing `branch_id` re-scopes the zone **and its area claims together**, in
 * one transaction, and is refused with a `409` when some other zone already
 * serves one of those areas at the destination.
 */
final class DeliveryZoneUpdateController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly DeliveryZoneLocator $locator,
        private readonly DeliveryZoneService $zones,
        private readonly DeliveryAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateDeliveryZoneRequest $request, string $zone): JsonResponse
    {
        $record = $this->locator->zone($zone);
        $updated = $this->zones->update($record, $request->payload(), $this->requiredLockVersion($request));

        return ApiResponse::data(['delivery_zone' => $this->presenter->zone($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
