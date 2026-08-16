<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Contracts\SubscriptionOutlook;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;

/**
 * The subscriptions module's answer to the orders module's calendar port (C4).
 *
 * Bound over `NullSubscriptionOutlook` by `SubscriptionsServiceProvider::boot()`
 * — in `boot()` rather than `register()` for the reason the delivery module
 * gives about `DeliveryJobProjection`: every provider's `register()` runs before
 * any `boot()`, so an override declared there wins whatever order package
 * discovery happens to put the two modules in.
 *
 * The read stays in the module that owns the tables, which is the point of the
 * port. Orders may not import this module — the registry edge runs
 * Subscriptions → Orders, and a reverse import would close the cycle the
 * architecture test rejects — so the desk calendar asks its question through an
 * interface and never learns that `subscription_deliveries` exists.
 *
 * ## Two bases, two sources, and only one of them is expensive
 *
 * **`scheduled` is read straight from the table**, and deliberately not derived
 * from the projection's `actual` rows. Two reasons, and both are correctness
 * rather than economy. The projection does not carry `order_id`, so it cannot
 * tell a claimed day apart from a day that has already become an order — and
 * counting the latter here would double it, because the orders module is already
 * counting the real order on its own basis. And the projection walks *active*
 * subscriptions only, while a claimed row outlives the pause that came after it:
 * the day is still on the kitchen's book, and dropping it would understate
 * tomorrow's work.
 *
 * The predicate is `status = scheduled AND order_id IS NULL`. `scheduled` is
 * generation's claim, taken before the order is placed; once the order exists
 * the row moves to `generated` and carries the identifier, so the second half of
 * the predicate is belt and braces against a row caught mid-flight rather than a
 * second rule. Skipped and cancelled rows are excluded by the status alone —
 * a skipped day is not a delivery, it is the absence of one.
 *
 * **`projected` delegates to `ScheduleProjection`, once.** That class is the
 * single definition of "what the weekday pattern says next week looks like", and
 * a second implementation here would be a second answer to the same question on
 * the one screen where they sit side by side. Its `actual` rows are dropped:
 * they are the same rows the scheduled query just read, counted by a basis that
 * already owns them.
 *
 * The projection is called exactly once per invocation, and the port's single
 * method is what guarantees it — see `SubscriptionOutlook`.
 *
 * ## `branchId` narrows the two bases on two different columns, deliberately
 *
 * `scheduled` filters `subscription_deliveries.branch_id`, which generation
 * denormalises onto the row at the moment it claims the day; `projected` filters
 * `subscriptions.branch_id`, because there is no row to have denormalised
 * anything onto. Each is the only column its own basis has, and the difference
 * is visible for exactly one case: a subscription moved between branches after a
 * day was claimed keeps that claimed day at the old site while its forecast
 * moves to the new one. That is the truthful answer — the claimed day really is
 * the old kitchen's work — and collapsing the two onto the subscription's
 * current branch would silently re-assign food somebody has already committed to
 * cooking.
 */
final readonly class SubscriptionOutlookAdapter implements SubscriptionOutlook
{
    public function __construct(private ScheduleProjection $projection) {}

    /**
     * @return array{
     *     scheduled: list<array{delivery_date: string, delivery_window_code: string|null}>,
     *     projected: list<array{delivery_date: string, delivery_window_code: string|null}>,
     * }
     */
    public function forWindow(
        string $organisationId,
        CarbonImmutable $from,
        CarbonImmutable $to,
        ?string $branchId = null,
    ): array {
        $start = $from->startOfDay();
        $end = $to->startOfDay();

        if ($end->lessThan($start)) {
            return ['scheduled' => [], 'projected' => []];
        }

        return [
            'scheduled' => $this->scheduled($organisationId, $start, $end, $branchId),
            'projected' => $this->projected($organisationId, $start, $end, $branchId),
        ];
    }

    /**
     * Days the generator has claimed and not yet turned into an order.
     *
     * `organisation_id` is denormalised onto this table precisely so a
     * projection needs no join, and the composite index on
     * `(organisation_id, delivery_date, status)` is the one this predicate was
     * written for.
     *
     * @return list<array{delivery_date: string, delivery_window_code: string|null}>
     */
    private function scheduled(
        string $organisationId,
        CarbonImmutable $start,
        CarbonImmutable $end,
        ?string $branchId,
    ): array {
        $rows = SubscriptionDelivery::query()
            ->where('organisation_id', $organisationId)
            ->where('status', SubscriptionDeliveryStatus::Scheduled->value)
            ->whereNull('order_id')
            ->whereBetween('delivery_date', [$start->toDateString(), $end->toDateString()])
            ->when($branchId !== null, fn ($query) => $query->where('branch_id', $branchId))
            ->orderBy('delivery_date')
            ->orderBy('id')
            ->get(['delivery_date', 'delivery_window_code']);

        $days = [];

        foreach ($rows as $row) {
            $days[] = [
                'delivery_date' => $row->delivery_date->toDateString(),
                'delivery_window_code' => $row->delivery_window_code,
            ];
        }

        return $days;
    }

    /**
     * Days the weekday pattern says are coming, which no row asserts.
     *
     * A forecast, and the port's docblock says so at length: the projection
     * reads weekdays and balances and never consults `next_generation_date`, so
     * it stays optimistic while a lagging generator catches up. Paused
     * subscriptions project nothing at all, because a paused arrangement
     * delivers nothing until somebody resumes it and no date can be predicted
     * for that.
     *
     * @return list<array{delivery_date: string, delivery_window_code: string|null}>
     */
    private function projected(
        string $organisationId,
        CarbonImmutable $start,
        CarbonImmutable $end,
        ?string $branchId,
    ): array {
        $days = [];

        foreach ($this->projection->forOrganisation($organisationId, $start, $end, $branchId) as $row) {
            // `actual` rows are the same `subscription_deliveries` the scheduled
            // query just read, and the ones that have become orders belong to
            // the orders module's basis. Either way they are already counted.
            if ($row['basis'] !== 'projected') {
                continue;
            }

            $days[] = [
                'delivery_date' => $row['delivery_date'],
                'delivery_window_code' => $row['delivery_window_code'],
            ];
        }

        return $days;
    }
}
