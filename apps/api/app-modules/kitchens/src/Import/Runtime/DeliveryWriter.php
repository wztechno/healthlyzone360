<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\ReferenceData\Models\DeliveryArea;

/**
 * Where the kitchen delivers and when.
 *
 * **One zone, all 125 areas, no fee and no minimum.** The workbook lists the
 * Lebanese delivery areas — already platform reference data, seeded in K1.7 —
 * and says nothing about splitting them into zones, charging differently
 * between them, or setting a minimum order anywhere. So the import creates the
 * only thing the source supports: a single organisation-wide zone claiming
 * every Lebanese area, with `delivery_fee_minor` and `minimum_order_minor`
 * NULL.
 *
 * A NULL fee is not a free delivery. The column is nullable precisely so that
 * "we have not decided" is representable, and a zero would have been a
 * commercial commitment nobody made — one an order total would then honour.
 * The known-gaps report says so in as many words.
 *
 * **Organisation-wide rather than pinned to the Main Kitchen.** `ZoneResolver`
 * lets a branch claim beat the organisation-wide one, so an org-wide zone is
 * the right base layer: a second branch can carve out its own areas later
 * without the first import having to be undone.
 *
 * **Three windows with no times.** The customer-data workbook's Delivery Window
 * dropdown reads Morning / Afternoon / Evening and gives no hours anywhere.
 * `starts_at` and `ends_at` are therefore NULL — the half-finished state the
 * schema explicitly permits — and `weekdays` is `[]`, which this system defines
 * as every day rather than as none.
 */
final readonly class DeliveryWriter
{
    public const string ZONE_CODE = 'greenlife-delivery';

    public function __construct(private string $sourceSystem) {}

    /**
     * @param  array{delivery_windows: list<array{code: string, name: string}>, delivery_area_count: int|null, findings: list<array{code: string, detail: string}>}  $parsed
     */
    public function write(array $parsed, string $organisationId, ImportReport $report): void
    {
        $report->findings($parsed['findings'], SourceManifest::CUSTOMERS);

        $areas = DeliveryArea::query()
            ->where('country_code', 'LB')
            ->orderBy('display_order')
            ->get(['id', 'code']);

        $report->knownGap(
            'delivery_zone_fee_and_minimum_unknown',
            sprintf(
                'The single %s zone claims all %d Lebanese areas with a NULL delivery fee and a NULL minimum '
                .'order. The workbook states neither, and a zero would have been a commercial commitment '
                .'nobody made.',
                self::ZONE_CODE,
                $areas->count(),
            ),
        );

        $report->knownGap(
            'delivery_window_times_unknown',
            'The three delivery windows carry no start or end time. The customer-data workbook names them and '
            .'gives no hours.',
        );

        if ($parsed['delivery_area_count'] !== null && $parsed['delivery_area_count'] !== $areas->count()) {
            $report->finding(
                'delivery_area_count_differs',
                sprintf(
                    'The workbook heading names %d delivery areas; the platform gazetteer holds %d for Lebanon.',
                    $parsed['delivery_area_count'],
                    $areas->count(),
                ),
                SourceManifest::CUSTOMERS,
            );
        }

        $this->writeZone(array_values($areas->all()), $organisationId, $report);
        $this->writeWindows($parsed['delivery_windows'], $organisationId, $report);
    }

    /**
     * @param  list<DeliveryArea>  $areas
     */
    private function writeZone(array $areas, string $organisationId, ImportReport $report): void
    {
        $existing = DeliveryZone::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('code', self::ZONE_CODE)
            ->first();

        if ($existing instanceof DeliveryZone) {
            $report->skipped('delivery_zone');
            $this->writeZoneAreas($existing, $areas, $organisationId, $report);

            return;
        }

        $report->created('delivery_zone');

        $zone = new DeliveryZone;
        $zone->organisation_id = $organisationId;
        $zone->branch_id = null;
        $zone->code = self::ZONE_CODE;
        $zone->name_en = 'Lebanon delivery';
        $zone->name_ar = 'التوصيل في لبنان';
        $zone->currency_code = GreenLifeWorld::CURRENCY;
        $zone->delivery_fee_minor = null;
        $zone->minimum_order_minor = null;
        $zone->estimated_minutes = null;
        $zone->status = DeliveryZoneStatus::Active;
        $zone->source_system = $this->sourceSystem;
        $zone->source_ref = SourceManifest::CUSTOMERS.'#delivery-areas';
        $zone->seeded_at = now();
        $zone->lock_version = 0;
        $zone->save();

        $this->writeZoneAreas($zone, $areas, $organisationId, $report);
    }

    /**
     * @param  list<DeliveryArea>  $areas
     */
    private function writeZoneAreas(DeliveryZone $zone, array $areas, string $organisationId, ImportReport $report): void
    {
        /** @var list<string> $claimed */
        $claimed = DeliveryZoneArea::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereNull('branch_id')
            ->pluck('delivery_area_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        foreach ($areas as $area) {
            if (in_array((string) $area->getKey(), $claimed, true)) {
                // Claimed already — by this zone on a previous run, or by an
                // operator who split the map since. Either way the partial
                // unique index would refuse the row, and overwriting somebody's
                // split is exactly what insert-if-absent exists to prevent.
                $report->skipped('delivery_zone_area');

                continue;
            }

            $row = new DeliveryZoneArea;
            $row->organisation_id = $organisationId;
            $row->delivery_zone_id = (string) $zone->getKey();
            $row->delivery_area_id = (string) $area->getKey();
            $row->branch_id = null;
            $row->save();

            $report->created('delivery_zone_area');
        }
    }

    /**
     * @param  list<array{code: string, name: string}>  $windows
     */
    private function writeWindows(array $windows, string $organisationId, ImportReport $report): void
    {
        foreach ($windows as $index => $definition) {
            $exists = DeliveryWindow::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('code', $definition['code'])
                ->exists();

            if ($exists) {
                $report->skipped('delivery_window');

                continue;
            }

            $report->created('delivery_window');

            $window = new DeliveryWindow;
            $window->organisation_id = $organisationId;
            $window->code = $definition['code'];
            $window->name_en = $definition['name'];
            $window->name_ar = $definition['name'];
            $window->starts_at = null;
            $window->ends_at = null;

            // Empty means every day (K1.7), not no days.
            $window->weekdays = [];
            $window->display_order = $index + 1;
            $window->is_active = true;
            $window->save();
        }
    }
}
