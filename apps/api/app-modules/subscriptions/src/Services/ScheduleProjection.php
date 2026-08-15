<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;

/**
 * What the kitchen has coming — computed, never created.
 *
 * **This class is why incremental generation is affordable.** §4 generates one
 * delivery ahead so that the order list is truthful, and the obvious objection
 * is that a kitchen then cannot see next week. The answer is that it sees next
 * week *here*: a read model over active subscriptions and their weekdays, with
 * the delivery rows that already exist laid over it. Nothing in this file
 * writes anything, and that is the whole guarantee — a projection that
 * materialised rows would be the phantom orders the design exists to avoid, and
 * would have to be un-materialised on every skip, pause and cancellation.
 *
 * **Projected days are labelled as projections.** Each row says whether it is
 * `actual` — a `subscription_deliveries` row that really exists — or
 * `projected`, computed from the weekday pattern and the remaining balance. A
 * kitchen planning production needs both and must never confuse them: an actual
 * day has an order behind it and a projected one is a customer who has not yet
 * had the chance to skip.
 *
 * **The balance bounds the projection.** A subscription with three days left
 * projects three more deliveries and then stops, however many weekdays remain
 * in the window. Pauses project nothing at all, because a paused subscription
 * delivers nothing until somebody resumes it and no date can be predicted for
 * that.
 */
final readonly class ScheduleProjection
{
    /**
     * Upcoming deliveries for one kitchen, day by day.
     *
     * @param  string|null  $branchId  narrow to one branch, or null for the whole organisation
     * @return list<array{
     *     delivery_date: string,
     *     subscription_id: string,
     *     customer_account_id: string,
     *     branch_id: string|null,
     *     delivery_window_code: string|null,
     *     basis: string,
     *     status: string,
     * }>
     */
    public function forOrganisation(
        string $organisationId,
        CarbonImmutable $from,
        CarbonImmutable $to,
        ?string $branchId = null,
    ): array {
        $start = $from->startOfDay();
        $end = $to->startOfDay();

        if ($end->lessThan($start)) {
            return [];
        }

        $subscriptions = Subscription::query()
            ->where('organisation_id', $organisationId)
            ->where('status', SubscriptionStatus::Active->value)
            ->when($branchId !== null, fn ($query) => $query->where('branch_id', $branchId))
            ->orderBy('id')
            ->get();

        $rows = [];

        foreach ($subscriptions as $subscription) {
            $actual = SubscriptionDelivery::query()
                ->where('subscription_id', $subscription->getKey())
                ->whereBetween('delivery_date', [$start->toDateString(), $end->toDateString()])
                ->get()
                ->keyBy(static fn (SubscriptionDelivery $row): string => $row->delivery_date->toDateString());

            $remaining = $subscription->remainingDays();

            for ($day = $start; $day->lessThanOrEqualTo($end); $day = $day->addDay()) {
                $key = $day->toDateString();
                $existing = $actual->get($key);

                if ($existing instanceof SubscriptionDelivery) {
                    $rows[] = $this->row($subscription, $day, 'actual', $existing->status->value, $existing->delivery_window_code);

                    if ($existing->consumed) {
                        $remaining--;
                    }

                    continue;
                }

                if (! $subscription->deliversOnWeekday($day->dayOfWeekIso)) {
                    continue;
                }

                if ($remaining < 1) {
                    // The balance runs out mid-window. Projecting past it would
                    // promise the kitchen food nobody has bought.
                    break;
                }

                $remaining--;

                $rows[] = $this->row($subscription, $day, 'projected', SubscriptionDeliveryStatus::Scheduled->value, $subscription->delivery_window_code);
            }
        }

        usort($rows, static fn (array $left, array $right): int => [$left['delivery_date'], $left['subscription_id']] <=> [$right['delivery_date'], $right['subscription_id']]);

        return $rows;
    }

    /**
     * How many deliveries each day of the window carries — the number a
     * production plan is built from.
     *
     * @return array<string, int>
     */
    public function dailyCounts(
        string $organisationId,
        CarbonImmutable $from,
        CarbonImmutable $to,
        ?string $branchId = null,
    ): array {
        $counts = [];

        foreach ($this->forOrganisation($organisationId, $from, $to, $branchId) as $row) {
            if (in_array($row['status'], [
                SubscriptionDeliveryStatus::SkippedCustomer->value,
                SubscriptionDeliveryStatus::SkippedNoSafeMeal->value,
                SubscriptionDeliveryStatus::SkippedUnavailable->value,
                SubscriptionDeliveryStatus::Cancelled->value,
            ], true)) {
                continue;
            }

            $counts[$row['delivery_date']] = ($counts[$row['delivery_date']] ?? 0) + 1;
        }

        return $counts;
    }

    /**
     * @return array{
     *     delivery_date: string,
     *     subscription_id: string,
     *     customer_account_id: string,
     *     branch_id: string|null,
     *     delivery_window_code: string|null,
     *     basis: string,
     *     status: string,
     * }
     */
    private function row(Subscription $subscription, CarbonImmutable $day, string $basis, string $status, ?string $window): array
    {
        return [
            'delivery_date' => $day->toDateString(),
            'subscription_id' => (string) $subscription->getKey(),
            'customer_account_id' => $subscription->customer_account_id,
            'branch_id' => $subscription->branch_id,
            'delivery_window_code' => $window,
            'basis' => $basis,
            'status' => $status,
        ];
    }
}
