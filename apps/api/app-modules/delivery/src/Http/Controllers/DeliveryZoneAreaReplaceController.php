<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Http\Concerns\ReadsPrecondition;
use Healthy360\Delivery\Http\Requests\ReplaceDeliveryZoneAreasRequest;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Delivery\Presenters\DeliveryAreaPresenter;
use Healthy360\Delivery\Services\DeliveryZoneLocator;
use Healthy360\Delivery\Services\ZoneAreaService;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/delivery-zones/{zone}/areas — set-replace, behind
 * `precondition` carrying the **zone's** validator.
 *
 * The body is the desired whole map. Areas absent from it are released, which
 * is the only way to hand a place to a different zone — the "one area, one
 * zone per branch" rule means a place cannot be in two zones at the same
 * scope, so adding it somewhere else has to be preceded by removing it here.
 *
 * A collision is a `409` naming the occupying zone, not a constraint
 * violation naming an index: the caller's next move is to open that zone, and
 * the response says which one.
 *
 * An area in another country is a `422` with `reason: area_country_mismatch`.
 * The gazetteer is keyed `(country, code)` precisely because place names
 * repeat, so a foreign area is what a mistyped import produces rather than a
 * cross-border delivery anybody has asked for.
 */
final class DeliveryZoneAreaReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly DeliveryZoneLocator $locator,
        private readonly ZoneAreaService $areas,
        private readonly DeliveryAreaPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceDeliveryZoneAreasRequest $request, string $zone): JsonResponse
    {
        $record = $this->locator->zone($zone);
        $updated = $this->areas->replace($record, $request->areaIds(), $this->requiredLockVersion($request));

        /** @var list<string> $areaIds */
        $areaIds = DeliveryZoneArea::query()
            ->where('delivery_zone_id', $updated->getKey())
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
                'scope' => $updated->isOrganisationWide() ? 'organisation' : 'branch',
            ],
        )->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
