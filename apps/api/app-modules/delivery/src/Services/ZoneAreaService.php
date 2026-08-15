<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The areas one zone covers, replaced as a set.
 *
 * A map is one decision. "Achrafieh, Badaro, Hamra — and not Verdun any more"
 * is a single act of redrawing, and applying half of it leaves a kitchen
 * quoting for a street it stopped serving. So the body is the desired **whole**
 * set and the server computes the difference, the shape every other
 * set-replace in this programme uses.
 *
 * ## The one-zone-per-area rule
 *
 * The database enforces `UNIQUE (organisation_id, branch_id, delivery_area_id)
 * NULLS NOT DISTINCT`, and this service enforces it **first**, so the caller
 * gets a `409` naming the zone that already holds the area rather than a
 * constraint violation naming an index. The two are not redundant: the
 * constraint is what makes the rule true under concurrency, and the check is
 * what makes it explicable.
 *
 * What the rule does *not* forbid is an organisation-wide zone and a
 * branch-scoped zone claiming the same area. That is the override mechanism —
 * see `ZoneResolver`, which decides that the branch claim wins — and a check
 * that refused it would make branch scoping useless.
 *
 * ## Two refusals worth stating
 *
 * **An inactive area cannot be claimed.** The platform deactivates a place
 * when it stops being a usable destination, and letting a kitchen add one
 * anyway would produce a map that promises deliveries to somewhere the
 * platform has withdrawn. Areas already claimed before a deactivation stay —
 * removing them silently would be worse — and the presenter marks them.
 *
 * **An area outside the organisation's country is a 422.** A Lebanese
 * kitchen claiming a UAE area is a mistake in every case anybody has
 * described: the gazetteer is keyed `(country, code)` precisely because place
 * names repeat, so `hamra` in the wrong country is exactly what a mistyped
 * import produces. This is the rule most likely to need revisiting — a kitchen
 * near a border genuinely might deliver across one — and when that day comes
 * it becomes an explicit per-organisation allowance rather than a silent
 * loosening here.
 */
final readonly class ZoneAreaService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private DeliveryZoneService $zones,
    ) {}

    /**
     * @param  list<string>  $areaIds  platform `delivery_areas` identifiers
     *
     * @throws ApiException
     */
    public function replace(DeliveryZone $zone, array $areaIds, int $expectedLockVersion): DeliveryZone
    {
        $this->zones->assertEditable($zone);

        $requested = $this->uniqueAreaIds($areaIds);
        $areas = $this->usableAreas($zone, $requested);
        $this->assertUnoccupied($zone, $requested);

        $existing = DeliveryZoneArea::withoutTenancy()
            ->where('delivery_zone_id', $zone->getKey())
            ->pluck('delivery_area_id')
            ->all();

        DB::transaction(function () use ($zone, $requested, $existing, $expectedLockVersion): void {
            $this->zones->compareAndSwap($zone, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            $removed = array_values(array_diff($existing, $requested));

            if ($removed !== []) {
                DeliveryZoneArea::withoutTenancy()
                    ->where('delivery_zone_id', $zone->getKey())
                    ->whereIn('delivery_area_id', $removed)
                    ->delete();
            }

            foreach (array_diff($requested, $existing) as $areaId) {
                $row = new DeliveryZoneArea;
                $row->organisation_id = $zone->organisation_id;
                $row->delivery_zone_id = (string) $zone->getKey();
                $row->delivery_area_id = $areaId;
                // The denormalised copy of the zone's scope, written here and
                // nowhere else. It is what the unique index reads.
                $row->branch_id = $zone->branch_id;
                $row->created_by = $this->context->userId();
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.delivery_zone_areas_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'delivery_zone',
            subjectId: (string) $zone->getKey(),
            metadata: [
                'changed_fields' => ['areas'],
                'area_count' => count($requested),
                'added_count' => count(array_diff($requested, $existing)),
                'removed_count' => count(array_diff($existing, $requested)),
                'inactive_area_count' => $areas->filter(static fn (DeliveryArea $area): bool => ! $area->is_active)->count(),
                'lock_version' => $zone->lock_version,
            ],
        );

        return $zone;
    }

    /**
     * @param  list<string>  $areaIds
     * @return list<string>
     *
     * @throws ApiException
     */
    private function uniqueAreaIds(array $areaIds): array
    {
        $seen = [];

        foreach ($areaIds as $index => $areaId) {
            $trimmed = trim($areaId);

            if ($trimmed === '') {
                throw $this->invalid("service_area_ids.{$index}", 'An entry has to name an area.');
            }

            if (in_array($trimmed, $seen, true)) {
                throw $this->invalid(
                    "service_area_ids.{$index}",
                    'This area is named twice. A zone covers a place once — twice is a duplicate, not a stronger claim.',
                );
            }

            $seen[] = $trimmed;
        }

        return $seen;
    }

    /**
     * Every named area, proven to exist, to be usable, and to be in the
     * organisation's own country.
     *
     * @param  list<string>  $areaIds
     * @return Collection<int, DeliveryArea>
     *
     * @throws ApiException
     */
    private function usableAreas(DeliveryZone $zone, array $areaIds)
    {
        if ($areaIds === []) {
            return collect();
        }

        $areas = DeliveryArea::query()->whereIn('id', $areaIds)->get();

        $missing = array_values(array_diff($areaIds, $areas->map(static fn (DeliveryArea $area): string => (string) $area->getKey())->all()));

        if ($missing !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'One or more of these areas is not in the platform gazetteer.',
                ['unknown_delivery_area_ids' => $missing],
            );
        }

        $countryCode = Organisation::query()->whereKey($zone->organisation_id)->value('country_code');

        $foreign = $areas
            ->filter(static fn (DeliveryArea $area): bool => $area->country_code !== $countryCode)
            ->map(static fn (DeliveryArea $area): string => (string) $area->getKey())
            ->values()
            ->all();

        if ($foreign !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'These areas are in another country. A zone covers places in the country its organisation operates in.',
                [
                    'reason' => 'area_country_mismatch',
                    'organisation_country' => is_string($countryCode) ? $countryCode : null,
                    'delivery_area_ids' => $foreign,
                ],
            );
        }

        // Already-claimed inactive areas are kept; newly claimed ones are
        // refused. The distinction matters: a kitchen must not be forced to
        // rebuild a map because the platform withdrew a place it once served,
        // and must not be allowed to promise a place the platform has
        // withdrawn.
        $existing = DeliveryZoneArea::withoutTenancy()
            ->where('delivery_zone_id', $zone->getKey())
            ->pluck('delivery_area_id')
            ->all();

        $newlyInactive = $areas
            ->filter(static fn (DeliveryArea $area): bool => ! $area->is_active && ! in_array((string) $area->getKey(), $existing, true))
            ->map(static fn (DeliveryArea $area): string => (string) $area->getKey())
            ->values()
            ->all();

        if ($newlyInactive !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'One or more of these areas has been withdrawn from the platform gazetteer and cannot be added to a zone.',
                ['reason' => 'area_inactive', 'delivery_area_ids' => $newlyInactive],
            );
        }

        return $areas;
    }

    /**
     * The one-zone-per-area rule, checked before the constraint so the answer
     * names the occupying zone.
     *
     * @param  list<string>  $areaIds
     *
     * @throws ApiException
     */
    private function assertUnoccupied(DeliveryZone $zone, array $areaIds): void
    {
        if ($areaIds === []) {
            return;
        }

        $occupied = DeliveryZoneArea::withoutTenancy()
            ->where('organisation_id', $zone->organisation_id)
            ->where('delivery_zone_id', '!=', $zone->getKey())
            ->whereIn('delivery_area_id', $areaIds)
            // Same scope only. An organisation-wide claim and a branch-scoped
            // one are allowed to coexist — that is the override, resolved by
            // ZoneResolver, not a collision.
            ->when($zone->branch_id === null, fn ($query) => $query->whereNull('branch_id'))
            ->when($zone->branch_id !== null, fn ($query) => $query->where('branch_id', $zone->branch_id))
            ->get();

        if ($occupied->isEmpty()) {
            return;
        }

        $conflicts = $occupied
            ->map(static fn (DeliveryZoneArea $row): array => [
                'delivery_area_id' => $row->delivery_area_id,
                'delivery_zone_id' => $row->delivery_zone_id,
            ])
            ->values()
            ->all();

        /** @var list<string> $zoneIds */
        $zoneIds = $occupied->pluck('delivery_zone_id')->unique()->values()->all();

        $names = DeliveryZone::withoutTenancy()
            ->whereIn('id', $zoneIds)
            ->pluck('code', 'id')
            ->all();

        throw new ApiException(
            ErrorCode::ResourceConflict,
            'Another zone at the same scope already serves one of these areas. An area is served by one zone per branch — move it out of the other zone first.',
            [
                'reason' => 'area_already_served',
                'scope' => $zone->branch_id === null ? 'organisation' : 'branch',
                'conflicts' => $conflicts,
                // Named as `occupying_zones` rather than `…_codes`: the audit
                // redaction matches `code` as a substring, and a details key
                // that reads well in one place and is erased in the other is
                // worse than one convention everywhere (OQ-036, R-019).
                'occupying_zones' => array_values($names),
            ],
        );
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
