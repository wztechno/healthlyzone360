<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Delivery\Presenters\DeliveryAreaPresenter;
use Healthy360\Delivery\Services\DeliveryZoneLocator;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/delivery-zones/{zone}/areas — the places this zone
 * covers.
 *
 * Unpaginated. The set is bounded by the gazetteer and is the unit a client
 * edits: a picker showing half a map, with a cursor to fetch the rest before
 * it can be submitted, would be a worse contract than one response.
 *
 * Each entry is the **platform area** in admin shape, including `is_active`.
 * A kitchen must be able to see that a place it still serves has been
 * withdrawn from the gazetteer — the claim is kept rather than silently
 * dropped, and `meta.inactive_area_count` is what a screen puts a warning
 * badge on.
 */
final class DeliveryZoneAreaIndexController
{
    public function __construct(
        private readonly DeliveryZoneLocator $locator,
        private readonly DeliveryAreaPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $zone): JsonResponse
    {
        $record = $this->locator->zone($zone);

        /** @var list<string> $areaIds */
        $areaIds = DeliveryZoneArea::query()
            ->where('delivery_zone_id', $record->getKey())
            ->pluck('delivery_area_id')
            ->all();

        $areas = $areaIds === []
            ? collect()
            : DeliveryArea::query()
                ->whereIn('id', $areaIds)
                ->orderBy('display_order')
                ->orderBy('code')
                ->get();

        return ApiResponse::data(
            $areas->map(fn (DeliveryArea $area): array => $this->presenter->admin($area))->all(),
            [
                'count' => $areas->count(),
                'inactive_area_count' => $areas->filter(static fn (DeliveryArea $area): bool => ! $area->is_active)->count(),
                'scope' => $record->isOrganisationWide() ? 'organisation' : 'branch',
            ],
        )->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
