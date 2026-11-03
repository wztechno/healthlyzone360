<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Illuminate\Support\Facades\DB;

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
 * | rule | customer | desk | subscription, accepted quotation |
 * |---|---|---|---|
 * | `closed`, `date_in_the_past`, `cut_off_passed` | yes | yes | today's path |
 * | `window_ended` | yes | yes | no |
 * | `lead_time_not_met` | yes | no | no |
 * | `below_zone_minimum` | yes | no | no |
 * | `kitchen_not_open`, `kitchen_paused` | yes | warned | no |
 * | `window_full` | yes | warned | no |
 *
 * **The desk's override of the two brakes is the desk itself.** A cashier is
 * talking to the kitchen, so the quote says the kitchen is paused or the slot is
 * full, and the agent decides. What the desk sells still fills the window, as a
 * subscription day and an accepted quotation do: they are all plates to cook.
 *
 * **A branch answers for itself.** Each is tested on its own clock, and the order
 * is refused only when every serving branch refuses it, reporting the first
 * branch's first refusal. A day is a date on a wall in that branch's town: a
 * window can only have ended on that branch's today, while a lead time reaches
 * any day, because an early window tomorrow can already be too soon tonight.
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
     * The first day from `$date` on which some serving branch is not `closed` by its
     * week or a closure: `$date` itself when it is open, null when nothing opens in
     * `$days` more. A cut-off or a past date is not a closure. A kitchen with no
     * active branch answers `$date`: there is no week to move along.
     */
    public function nextOpenDay(
        string $organisationId,
        ?string $branchId,
        ?DeliveryZone $zone,
        CarbonImmutable $date,
        CarbonImmutable $now,
        int $days,
    ): ?CarbonImmutable {
        $branchIds = $this->branches->for($organisationId, $branchId, $zone);

        if ($branchIds === []) {
            return $date;
        }

        foreach (range(0, $days) as $offset) {
            $day = $date->addDays($offset);

            foreach ($branchIds as $candidate) {
                if (($this->scheduleRefusal($candidate, $day, $now)['reason'] ?? null) !== 'closed') {
                    return $day;
                }
            }
        }

        return null;
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
     * `kitchen_not_open` until a new kitchen goes live, and `kitchen_paused` while
     * its timed pause runs.
     *
     * @return list<array<string, mixed>>
     */
    public function pauseRefusals(string $organisationId, CarbonImmutable $now): array
    {
        $settings = $this->settings->for($organisationId);

        if ($settings->not_open_yet) {
            return [['reason' => 'kitchen_not_open']];
        }

        $pausedUntil = $settings->paused_until;

        if ($pausedUntil === null || $pausedUntil->lessThanOrEqualTo($now)) {
            return [];
        }

        return [['reason' => 'kitchen_paused', 'paused_until' => $pausedUntil->toIso8601String()]];
    }

    /**
     * `window_full` once this day's window holds as many orders as the kitchen said
     * it can take. The early answer, for the preview and the desk's warning;
     * {@see holdCapacity()} is the one that holds under concurrent placement.
     *
     * An order with no day or no window fills no window, and a kitchen with no
     * limit set has no such thing as full.
     *
     * @return list<array<string, mixed>>
     */
    public function capacityRefusals(string $organisationId, ?CarbonImmutable $date, ?string $deliveryWindowCode): array
    {
        $limit = $this->settings->for($organisationId)->orders_per_window;

        if ($limit === null || ! $date instanceof CarbonImmutable || $deliveryWindowCode === null) {
            return [];
        }

        if ($this->ordersIn($organisationId, $date, $deliveryWindowCode) < $limit) {
            return [];
        }

        return [[
            'reason' => 'window_full',
            'requested_date' => $date->toDateString(),
            'delivery_window_code' => $deliveryWindowCode,
        ]];
    }

    /**
     * Refuse the order just written if it took the window past the limit.
     *
     * Inside the placement's transaction, after the row exists. The advisory lock
     * lasts until commit, so of two checkouts racing for the last place the second
     * waits, counts the first and rolls itself back. Counting before the insert
     * could not do this: neither would see the other. The lock is per kitchen, day
     * and window, so nothing else queues behind it.
     *
     * @throws PlacementRefused
     */
    public function holdCapacity(Order $order): void
    {
        $date = $order->requested_delivery_date;
        $code = $order->delivery_window_code;
        $limit = $this->settings->for($order->organisation_id)->orders_per_window;

        if ($limit === null || $date === null || $code === null) {
            return;
        }

        DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [
            "window-capacity:{$order->organisation_id}:{$date->toDateString()}:{$code}",
        ]);

        if ($this->ordersIn($order->organisation_id, $date, $code) > $limit) {
            throw new PlacementRefused([[
                'reason' => 'window_full',
                'requested_date' => $date->toDateString(),
                'delivery_window_code' => $code,
            ]]);
        }
    }

    /**
     * Every order the kitchen still owes or already cooked for that window. A
     * fulfilled order took its place on the line as much as an open one did; only
     * a cancelled one gave it back.
     */
    private function ordersIn(string $organisationId, CarbonImmutable $date, string $deliveryWindowCode): int
    {
        return DB::table('orders')
            ->where('organisation_id', $organisationId)
            ->where('requested_delivery_date', $date->toDateString())
            ->where('delivery_window_code', $deliveryWindowCode)
            ->where('status', '<>', OrderStatus::Cancelled->value)
            ->count();
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

        if ($window?->starts_at === null || $window->ends_at === null) {
            return null;
        }

        // Instants rather than clock faces: a lead time can run past midnight,
        // and "01:00" sorts before "09:00" whichever day it is on.
        $requested = $day->toDateString();
        $startsAt = CarbonImmutable::parse("{$requested} {$window->starts_at}", $timezone);
        $endsAt = CarbonImmutable::parse("{$requested} {$window->ends_at}", $timezone);

        if ($requested === $local->toDateString() && $local->greaterThanOrEqualTo($endsAt)) {
            return [
                'reason' => 'window_ended',
                'branch_id' => $branchId,
                'requested_date' => $requested,
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
            'requested_date' => $requested,
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
