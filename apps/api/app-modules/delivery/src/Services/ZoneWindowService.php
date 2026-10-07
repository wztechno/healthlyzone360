<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneWindow;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Which of the organisation's windows each zone offers — and the one place
 * that answers "is this slot offered to this address".
 *
 * A window is still one organisation-wide vocabulary; the assignment says
 * which zones it runs in. **Offered = assigned to the zone and active.** An
 * inactive window may stay assigned (re-activating it restores it where it
 * was) but is never offered. A newly created window is assigned nowhere.
 *
 * `replace()` mirrors `ZoneAreaService::replace()`: the body is the whole set,
 * the zone's `lock_version` is the validator, the diff is applied inside the
 * compare-and-swap's transaction.
 *
 * Every read here bypasses the tenancy scope and filters on the zone's own
 * organisation instead, because subscription generation and placement reach
 * it from contexts that are not the kitchen's own request.
 */
final readonly class ZoneWindowService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private DeliveryZoneService $zones,
    ) {}

    /**
     * @param  list<string>  $windowIds
     *
     * @throws ApiException
     */
    public function replace(DeliveryZone $zone, array $windowIds, int $expectedLockVersion): DeliveryZone
    {
        $this->zones->assertEditable($zone);

        $requested = array_values(array_unique($windowIds));

        /** @var list<string> $known */
        $known = DeliveryWindow::withoutTenancy()
            ->where('organisation_id', $zone->organisation_id)
            ->whereIn('id', $requested)
            ->pluck('id')
            ->all();

        $unknown = array_values(array_diff($requested, $known));

        if ($unknown !== []) {
            $message = 'One or more of these windows is not one of this organisation\'s delivery windows.';

            throw new ApiException(
                ErrorCode::ValidationFailed,
                $message,
                ['fields' => ['delivery_window_ids' => [$message]], 'unknown_delivery_window_ids' => $unknown],
            );
        }

        $existing = $this->windowIdsFor($zone);

        DB::transaction(function () use ($zone, $requested, $existing, $expectedLockVersion): void {
            $this->zones->compareAndSwap($zone, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            DeliveryZoneWindow::withoutTenancy()
                ->where('delivery_zone_id', $zone->getKey())
                ->whereIn('delivery_window_id', array_diff($existing, $requested))
                ->delete();

            foreach (array_diff($requested, $existing) as $windowId) {
                DeliveryZoneWindow::withoutTenancy()->create([
                    'organisation_id' => $zone->organisation_id,
                    'delivery_zone_id' => (string) $zone->getKey(),
                    'delivery_window_id' => $windowId,
                    'created_by' => $this->context->userId(),
                ]);
            }
        });

        $this->audit->record(
            'catalogue.delivery_zone_windows_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'delivery_zone',
            subjectId: (string) $zone->getKey(),
            metadata: [
                'changed_fields' => ['windows'],
                'window_count' => count($requested),
                'added_count' => count(array_diff($requested, $existing)),
                'removed_count' => count(array_diff($existing, $requested)),
                'lock_version' => $zone->lock_version,
            ],
        );

        return $zone;
    }

    /**
     * The windows assigned to one zone, active or not, in display order.
     *
     * @return list<string>
     */
    public function windowIdsFor(DeliveryZone $zone): array
    {
        return $this->windowIdsByZone([(string) $zone->getKey()])[(string) $zone->getKey()] ?? [];
    }

    /**
     * One query for a page of zones. Zones with no windows are absent from
     * the map; callers default to `[]`.
     *
     * @param  list<string>  $zoneIds
     * @return array<string, list<string>>
     */
    public function windowIdsByZone(array $zoneIds): array
    {
        if ($zoneIds === []) {
            return [];
        }

        $map = [];

        $rows = DeliveryZoneWindow::withoutTenancy()
            ->join('delivery_windows', 'delivery_windows.id', '=', 'delivery_zone_windows.delivery_window_id')
            ->whereIn('delivery_zone_windows.delivery_zone_id', $zoneIds)
            ->orderBy('delivery_windows.display_order')
            ->orderBy('delivery_windows.code')
            ->toBase()
            ->get(['delivery_zone_windows.delivery_zone_id', 'delivery_zone_windows.delivery_window_id']);

        foreach ($rows as $row) {
            $map[(string) $row->delivery_zone_id][] = (string) $row->delivery_window_id;
        }

        return $map;
    }

    /**
     * The inverse, for the window list: which zones offer each window.
     *
     * @param  list<string>  $windowIds
     * @return array<string, list<string>>
     */
    public function zoneIdsByWindow(array $windowIds): array
    {
        if ($windowIds === []) {
            return [];
        }

        $map = [];

        $rows = DeliveryZoneWindow::withoutTenancy()
            ->join('delivery_zones', 'delivery_zones.id', '=', 'delivery_zone_windows.delivery_zone_id')
            ->whereIn('delivery_zone_windows.delivery_window_id', $windowIds)
            ->orderBy('delivery_zones.code')
            ->toBase()
            ->get(['delivery_zone_windows.delivery_window_id', 'delivery_zone_windows.delivery_zone_id']);

        foreach ($rows as $row) {
            $map[(string) $row->delivery_window_id][] = (string) $row->delivery_zone_id;
        }

        return $map;
    }

    /**
     * The window codes an address in this zone may be offered: assigned and
     * active, in display order. The only definition of "offered" — preview,
     * desk quote and placement all read it.
     *
     * @return list<string>
     */
    public function offeredCodes(DeliveryZone $zone): array
    {
        /** @var list<string> $codes */
        $codes = DeliveryWindow::withoutTenancy()
            ->join('delivery_zone_windows', 'delivery_zone_windows.delivery_window_id', '=', 'delivery_windows.id')
            ->where('delivery_zone_windows.delivery_zone_id', $zone->getKey())
            ->where('delivery_windows.is_active', true)
            ->orderBy('delivery_windows.display_order')
            ->orderBy('delivery_windows.code')
            ->pluck('delivery_windows.code')
            ->all();

        return $codes;
    }

    /**
     * Assign windows to zones additively, without a validator or an audit
     * row — for seeders and the workbook importer only, which have to leave a
     * kitchen able to take delivery orders. Null means "all of the
     * organisation's" — active windows only, the migration's backfill rule —
     * on either side. Never removes an assignment.
     *
     * @param  list<string>|null  $windowIds
     * @param  list<string>|null  $zoneIds
     */
    public function assignAll(string $organisationId, ?array $windowIds = null, ?array $zoneIds = null): void
    {
        $zones = DB::table('delivery_zones')->where('organisation_id', $organisationId)
            ->when($zoneIds !== null, fn ($query) => $query->whereIn('id', $zoneIds))
            ->pluck('id');

        $windows = DB::table('delivery_windows')->where('organisation_id', $organisationId)
            ->when($windowIds !== null, fn ($query) => $query->whereIn('id', $windowIds), fn ($query) => $query->where('is_active', true))
            ->pluck('id');

        $rows = [];

        foreach ($zones as $zoneId) {
            foreach ($windows as $windowId) {
                $rows[] = [
                    'id' => (string) Str::uuid7(),
                    'organisation_id' => $organisationId,
                    'delivery_zone_id' => $zoneId,
                    'delivery_window_id' => $windowId,
                    'created_at' => now(),
                ];
            }
        }

        if ($rows !== []) {
            DB::table('delivery_zone_windows')->insertOrIgnore($rows);
        }
    }
}
