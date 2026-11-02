<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;

/**
 * Whether the kitchen can still make this order, as refusals.
 *
 * The one definition placement, the checkout preview and the desk quote all ask,
 * so that a screen never promises what the button then refuses. It sits beside
 * `ServingBranches` rather than inside `OrderPlacementService` because the
 * preview and the quote have no placement to borrow private methods from.
 *
 * **Who is asked what** is the caller's choice, and the table is the spec's:
 *
 * | rule | customer | desk, quotation | subscription |
 * |---|---|---|---|
 * | `closed`, `date_in_the_past`, `cut_off_passed` | yes | yes | today's path |
 * | `window_ended` | yes | yes | no |
 * | `lead_time_not_met` | yes | no | no |
 * | `below_zone_minimum` | yes | no | no |
 *
 * **A branch answers for itself.** Each is tested on its own clock, and the order
 * is refused only when every serving branch refuses it, reporting the first
 * branch's first refusal. A day is a date on a wall in that branch's town: the
 * time rules only ever apply when the date asked for is that branch's today.
 *
 * **A window with no hours has no time rules.** Somebody named it before deciding
 * them, and `DeliveryWindow` allows that.
 */
final readonly class OrderTimingRules
{
    public function __construct(
        private OrderSchedulingLookup $scheduling,
        private ServingBranches $branches,
        private KitchenServiceSettingsLookup $settings,
    ) {}

    /**
     * @param  CarbonImmutable|null  $date  the day asked for; null means each branch's own today
     * @param  bool  $leadTime  whether `order_lead_minutes` applies: customers only
     * @param  bool  $waiveCutOff  staff editing a placed order may override the cut-off, and nothing else
     * @return list<array<string, mixed>> empty, or the one refusal to report
     */
    public function refusals(
        string $organisationId,
        ?string $branchId,
        ?DeliveryZone $zone,
        ?CarbonImmutable $date,
        ?string $deliveryWindowCode,
        CarbonImmutable $now,
        bool $leadTime,
        bool $waiveCutOff = false,
    ): array {
        $branchIds = $this->branches->for($organisationId, $branchId, $zone);

        if ($branchIds === []) {
            return [['reason' => 'kitchen_closed', 'requested_date' => $date?->toDateString()]];
        }

        $window = $this->window($organisationId, $deliveryWindowCode);
        $first = null;

        foreach ($branchIds as $candidate) {
            $refusal = $this->branchRefusal($organisationId, $candidate, $date, $window, $now, $leadTime, $waiveCutOff);

            if ($refusal === null) {
                return [];
            }

            $first ??= $refusal;
        }

        return [$first];
    }

    /**
     * The branch's own answer about a day, with no window, lead time or fallback
     * to another branch.
     *
     * @return array<string, mixed>|null
     */
    public function scheduleRefusal(string $branchId, CarbonImmutable $date, CarbonImmutable $now): ?array
    {
        $schedule = $this->scheduling->explain($branchId, $date, $now);

        if ($schedule['accepted']) {
            return null;
        }

        return [
            'reason' => $schedule['reason'] ?? 'cut_off_passed',
            'branch_id' => $branchId,
            'requested_date' => $date->toDateString(),
            'cut_off_at' => $schedule['cut_off_at'],
        ];
    }

    /**
     * `below_zone_minimum` on the subtotal, delivery excluded. Customers only:
     * staff may agree a small order. A zone in another currency is not compared,
     * because comparing would mean converting.
     *
     * @return list<array<string, mixed>>
     */
    public function minimumRefusals(?DeliveryZone $zone, int $subtotalMinor, string $currencyCode): array
    {
        if (! $zone instanceof DeliveryZone
            || $zone->minimum_order_minor === null
            || $zone->currency_code !== $currencyCode
            || $subtotalMinor >= $zone->minimum_order_minor) {
            return [];
        }

        return [[
            'reason' => 'below_zone_minimum',
            'minimum_minor' => $zone->minimum_order_minor,
            'subtotal_minor' => $subtotalMinor,
            'currency_code' => $zone->currency_code,
            'delivery_zone_id' => (string) $zone->getKey(),
        ]];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function branchRefusal(
        string $organisationId,
        string $branchId,
        ?CarbonImmutable $date,
        ?DeliveryWindow $window,
        CarbonImmutable $now,
        bool $leadTime,
        bool $waiveCutOff,
    ): ?array {
        $timezone = $this->scheduling->timezoneOf($branchId);
        $local = $now->setTimezone($timezone);
        $day = $date ?? $local->startOfDay();

        $refusal = $this->scheduleRefusal($branchId, $day, $now);

        if ($refusal !== null && ! ($waiveCutOff && $refusal['reason'] === 'cut_off_passed')) {
            return $refusal;
        }

        if ($window?->starts_at === null || $window->ends_at === null || $day->toDateString() !== $local->toDateString()) {
            return null;
        }

        // Instants rather than clock faces: a lead time can run past midnight,
        // and "01:00" sorts before "09:00" whichever day it is on.
        $today = $local->toDateString();
        $startsAt = CarbonImmutable::parse("{$today} {$window->starts_at}", $timezone);
        $endsAt = CarbonImmutable::parse("{$today} {$window->ends_at}", $timezone);

        if ($local->greaterThanOrEqualTo($endsAt)) {
            return [
                'reason' => 'window_ended',
                'branch_id' => $branchId,
                'requested_date' => $today,
                'delivery_window_code' => $window->code,
                'ends_at' => $window->ends_at,
            ];
        }

        if (! $leadTime) {
            return null;
        }

        $minutes = $this->settings->for($organisationId)->order_lead_minutes;
        $earliest = $local->addMinutes($minutes);

        if ($earliest->lessThanOrEqualTo($startsAt)) {
            return null;
        }

        return [
            'reason' => 'lead_time_not_met',
            'branch_id' => $branchId,
            'requested_date' => $today,
            'delivery_window_code' => $window->code,
            'lead_minutes' => $minutes,
            'earliest_at' => $earliest->toIso8601String(),
        ];
    }

    /**
     * The window record behind a code. Null for a code naming no window, which
     * `window_not_offered` answers where a zone is involved.
     *
     * Read without the organisation scope, by the organisation already named: a
     * customer is a member of none, as `OrderWindowNames` explains.
     */
    private function window(string $organisationId, ?string $code): ?DeliveryWindow
    {
        if ($code === null) {
            return null;
        }

        return DeliveryWindow::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('code', $code)
            ->first();
    }
}
