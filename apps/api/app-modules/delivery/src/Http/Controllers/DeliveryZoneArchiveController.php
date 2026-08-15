<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Http\Concerns\ReadsPrecondition;
use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Delivery\Services\DeliveryZoneLocator;
use Healthy360\Delivery\Services\DeliveryZoneService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/delivery-zones/{zone}/archive.
 *
 * Terminal, and it **releases the zone's area claims**. That is the half worth
 * knowing: an archived zone that kept them would occupy every place it ever
 * served, and a kitchen redrawing its map would find the new zone refused by
 * one nobody uses. A kitchen that wants to stop delivering *without* giving
 * the areas up suspends the zone instead (`is_active: false` on the PATCH),
 * which is reversible and keeps the map intact.
 *
 * The zone itself is not deleted. Its fee, its promise and its name survive,
 * so a delivery quoted from it last month can still be explained.
 *
 * There is deliberately **no customer-address check**. `customer_addresses`
 * arrives in J1, so today there is nothing to consult and a blocker written
 * against an empty table would be a permanently-green check. J1 adds the
 * consultation — see `DeliveryZoneService::archive()`.
 */
final class DeliveryZoneArchiveController
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
    public function __invoke(Request $request, string $zone): JsonResponse
    {
        $record = $this->locator->zone($zone);
        $archived = $this->zones->archive($record, $this->requiredLockVersion($request));

        return ApiResponse::data(['delivery_zone' => $this->presenter->zone($archived)])
            ->withHeaders(['ETag' => '"'.$archived->lock_version.'"']);
    }
}
