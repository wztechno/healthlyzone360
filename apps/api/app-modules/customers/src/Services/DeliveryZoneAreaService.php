<?php

declare(strict_types=1);

namespace Healthy360\Customers\Services;

use Healthy360\Customers\Contracts\AreaServiceLookup;
use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Illuminate\Database\Eloquent\Builder;

/**
 * The port's one implementation, over the delivery module's own tables.
 *
 * It answers a *platform-wide* question — "does any kitchen serve this area" —
 * which is broader than what `ZoneResolver` answers ("which of *this*
 * kitchen's zones serves it"). The resolver's precedence rule (branch beats
 * organisation-wide) is about picking between two claims by one organisation
 * and does not apply to a question with no organisation in it: for "is this
 * area served at all", one active claim anywhere is a yes, and re-deriving a
 * precedence here would be inventing a second one.
 *
 * `withoutTenancy()` throughout, and deliberately: a customer saving an
 * address has no organisation context, and this must see every kitchen's map
 * rather than the ambient tenant's. It reads nothing but the existence of a
 * claim — no fee, no minimum, no zone name — so the cross-tenant read reveals
 * exactly what a kitchen already publishes on its own coverage page.
 */
final class DeliveryZoneAreaService implements AreaServiceLookup
{
    public function isServed(string $areaId): bool
    {
        return $this->activeClaims($areaId)->exists();
    }

    /**
     * @return list<string>
     */
    public function servingOrganisationIds(string $areaId): array
    {
        /** @var list<string> $ids */
        $ids = $this->activeClaims($areaId)
            ->pluck('organisation_id')
            ->unique()
            ->values()
            ->all();

        return $ids;
    }

    /**
     * @return Builder<DeliveryZoneArea>
     */
    private function activeClaims(string $areaId)
    {
        return DeliveryZoneArea::withoutTenancy()
            ->where('delivery_area_id', $areaId)
            ->whereIn('delivery_zone_id', DeliveryZone::withoutTenancy()
                ->where('status', DeliveryZoneStatus::Active)
                ->select('id'));
    }
}
