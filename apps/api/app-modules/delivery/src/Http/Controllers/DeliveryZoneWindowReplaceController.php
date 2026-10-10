<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Http\Concerns\ReadsPrecondition;
use Healthy360\Delivery\Http\Requests\ReplaceDeliveryZoneWindowsRequest;
use Healthy360\Delivery\Services\DeliveryZoneLocator;
use Healthy360\Delivery\Services\ZoneWindowService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/delivery-zones/{zone}/windows — set-replace behind
 * `precondition` carrying the zone's validator, exactly as `…/areas`.
 *
 * The body is the whole set. A window of another organisation (or none) is a
 * `422` on `delivery_window_ids`; an inactive window may be assigned — it is
 * simply not offered until it is re-activated.
 */
final class DeliveryZoneWindowReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly DeliveryZoneLocator $locator,
        private readonly ZoneWindowService $windows,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceDeliveryZoneWindowsRequest $request, string $zone): JsonResponse
    {
        $record = $this->locator->zone($zone);
        $updated = $this->windows->replace($record, $request->windowIds(), $this->requiredLockVersion($request));

        return ApiResponse::data(['delivery_window_ids' => $this->windows->windowIdsFor($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
