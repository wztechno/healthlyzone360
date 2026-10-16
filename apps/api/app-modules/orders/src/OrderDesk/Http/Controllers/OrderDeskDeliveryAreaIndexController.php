<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Delivery\Presenters\DeliveryAreaPresenter;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/order-desk/delivery-areas — the places a desk sale can
 * be delivered to.
 *
 * The desk's address picker used to offer the whole country's gazetteer, so an
 * agent could choose an area this kitchen never goes to and only learn so from
 * the refusal after pressing Save. This is the list narrowed to what the
 * desk's quote would accept: areas claimed by one of this kitchen's **active,
 * organisation-wide** zones. A desk sale states no branch, and with no branch
 * `ZoneResolver` consults only the organisation-wide map — so a branch-only
 * claim, or a suspended zone, would be offered here and then refused there.
 *
 * Areas the platform has withdrawn are left out even while a zone still claims
 * them: a new address must not be written against a place nobody can pick any
 * more. Behind the code that writes the address, not `delivery_zone.manage_
 * organisation`, which governs the map and which a desk agent need not hold.
 */
final class OrderDeskDeliveryAreaIndexController
{
    public function __construct(private readonly DeliveryAreaPresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $areas = DeliveryArea::query()
            ->where('is_active', true)
            ->whereIn('id', DeliveryZoneArea::query()
                ->whereNull('branch_id')
                ->whereIn('delivery_zone_id', DeliveryZone::query()
                    ->where('status', DeliveryZoneStatus::Active)
                    ->select('id'))
                ->select('delivery_area_id'))
            ->orderBy('display_order')
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            $areas->map(fn (DeliveryArea $area): array => $this->presenter->admin($area))->all(),
            ['count' => $areas->count()],
        );
    }
}
