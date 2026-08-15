<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Presenters;

use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;

/**
 * The administrative wire shapes of the delivery module.
 *
 * **Amounts leave as integers with their currency beside them, never
 * formatted** — the rule the whole programme follows (§4.4). A `null` fee is
 * served as `null` and never as `0`: "nobody has decided what delivery costs"
 * and "delivery is free" are different commercial statements, and coercing the
 * first into the second is the same class of mistake as rendering a
 * placeholder price as zero (OD-2, risk R9).
 *
 * `is_active` is derived from the status rather than stored beside it, so a
 * client has one field to read for "is this zone serving" and cannot be shown
 * a flag that disagrees with the lifecycle.
 *
 * Times are served as `HH:MM` — the shape a human wrote and a picker renders —
 * rather than the `HH:MM:SS` PostgreSQL returns. Seconds on a delivery window
 * are noise that every client would have to trim.
 */
final class DeliveryAdminPresenter
{
    /**
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     branch_id: string|null,
     *     scope: string,
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     currency_code: string,
     *     delivery_fee_minor: int|null,
     *     minimum_order_minor: int|null,
     *     estimated_minutes: int|null,
     *     status: string,
     *     is_active: bool,
     *     source_system: string|null,
     *     source_ref: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function zone(DeliveryZone $zone): array
    {
        return [
            'id' => (string) $zone->getKey(),
            'organisation_id' => $zone->organisation_id,
            'branch_id' => $zone->branch_id,
            // Stated rather than left to be inferred from a null branch_id: a
            // client rendering "organisation-wide" versus "Al Quoz only" should
            // not have to know that NULL is a meaningful value here.
            'scope' => $zone->isOrganisationWide() ? 'organisation' : 'branch',
            'code' => $zone->code,
            'name_en' => $zone->name_en,
            'name_ar' => $zone->name_ar,
            'currency_code' => $zone->currency_code,
            'delivery_fee_minor' => $zone->delivery_fee_minor,
            'minimum_order_minor' => $zone->minimum_order_minor,
            'estimated_minutes' => $zone->estimated_minutes,
            'status' => $zone->status->value,
            'is_active' => $zone->status->isServing(),
            'source_system' => $zone->source_system,
            'source_ref' => $zone->source_ref,
            'lock_version' => $zone->lock_version,
            'created_at' => $zone->created_at?->toIso8601String(),
            'updated_at' => $zone->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     starts_at: string|null,
     *     ends_at: string|null,
     *     weekdays: list<int>,
     *     display_order: int,
     *     is_active: bool,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function window(DeliveryWindow $window): array
    {
        return [
            'id' => (string) $window->getKey(),
            'organisation_id' => $window->organisation_id,
            'code' => $window->code,
            'name_en' => $window->name_en,
            'name_ar' => $window->name_ar,
            'starts_at' => self::clock($window->starts_at),
            'ends_at' => self::clock($window->ends_at),
            // Served as stored, empty array included. `[]` means every day and
            // is documented as such; expanding it to all seven here would hide
            // the convention from a client that then could not write it back.
            'weekdays' => $window->weekdays,
            'display_order' => $window->display_order,
            'is_active' => $window->is_active,
            'created_at' => $window->created_at?->toIso8601String(),
            'updated_at' => $window->updated_at?->toIso8601String(),
        ];
    }

    /**
     * `HH:MM:SS` from PostgreSQL, `HH:MM` on the wire.
     */
    public static function clock(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return mb_substr($value, 0, 5);
    }
}
