<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;

/*
|--------------------------------------------------------------------------
| The balance is a count of deliveries, and only a delivery spends one
|--------------------------------------------------------------------------
|
| The load-bearing sentence of the approved semantics (§1): "a 20-day plan = 20
| deliveries, not a calendar range. Skipping or pausing consumes nothing — the
| balance simply stretches into the future."
|
| Two assertions carry the whole model. A generated delivery takes exactly one
| day off the balance and leaves a real order behind it. A skip takes none, and
| the row that records it says so in its own columns rather than by being
| absent — which is what makes "you were not charged for that day" answerable
| six months later.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = SubscriptionWorld::build('balance@kitchen.test', perDayMinor: 2000, days: 20);
    $this->subscriptions = app(SubscriptionService::class);
    $this->generation = app(GenerationService::class);
});

it('spends one balance day per generated delivery and none for a skip', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    expect($subscription->status)->toBe(SubscriptionStatus::Active)
        ->and($subscription->balance_days_total)->toBe(20)
        ->and($subscription->balance_days_consumed)->toBe(0)
        ->and($subscription->remainingDays())->toBe(20);

    // The first delivery is the first day still outside the plan's 24-hour
    // change window — a subscription must never open with a delivery the
    // customer had no chance to stop.
    $first = $subscription->next_generation_date;

    expect($first)->not->toBeNull();

    // Nothing has crossed the boundary yet, so the tick creates nothing. This
    // is §4's incremental rule: no order exists until the change window closes.
    expect($this->generation->tick()['generated'])->toBe(0)
        ->and(Order::query()->count())->toBe(0);

    // A day later the first delivery's window has closed and exactly one order
    // is generated — one delivery ahead, never two.
    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    $tally = $this->generation->tick();

    expect($tally['generated'])->toBe(1)
        ->and(Order::query()->count())->toBe(1);

    $subscription->refresh();

    $delivery = SubscriptionDelivery::query()
        ->where('subscription_id', $subscription->getKey())
        ->whereDate('delivery_date', $first->toDateString())
        ->firstOrFail();

    expect($delivery->status)->toBe(SubscriptionDeliveryStatus::Generated)
        ->and($delivery->consumed)->toBeTrue()
        ->and($delivery->order_id)->not->toBeNull()
        ->and($subscription->balance_days_consumed)->toBe(1)
        ->and($subscription->remainingDays())->toBe(19);

    // Now the free half. The customer skips a day that is still outside the
    // window; the balance does not move and no order is placed for it.
    $toSkip = $subscription->next_generation_date->addDays(2);

    $skipped = $this->subscriptions->skip($subscription->refresh(), $toSkip);

    expect($skipped->status)->toBe(SubscriptionDeliveryStatus::SkippedCustomer)
        ->and($skipped->consumed)->toBeFalse()
        ->and($skipped->skip_reason)->toBe('customer_request')
        ->and($subscription->refresh()->balance_days_consumed)->toBe(1);

    // And the skipped day is never generated, however many ticks run past it:
    // the row is already there and the unique index is what guarantees it.
    CarbonImmutable::setTestNow($toSkip->addDay());

    $this->generation->tick();
    $this->generation->tick();

    expect(SubscriptionDelivery::query()
        ->where('subscription_id', $subscription->getKey())
        ->whereDate('delivery_date', $toSkip->toDateString())
        ->where('status', SubscriptionDeliveryStatus::SkippedCustomer->value)
        ->count())->toBe(1);

    CarbonImmutable::setTestNow();
});
