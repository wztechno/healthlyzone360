<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Exceptions\SubscriptionRefused;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Services\ChangeWindow;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\ScheduleProjection;
use Healthy360\Subscriptions\Services\StorefrontQuoting;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;

/*
|--------------------------------------------------------------------------
| A weekday the kitchen is shut on
|--------------------------------------------------------------------------
|
| The branch's opening hours say which days nothing is made. A subscriber is
| not offered such a day, is refused it if they ask anyway, is never sent an
| order for it — including on a subscription that names no branch, which the
| order book's own cut-off check never sees — and the kitchen's forecast does
| not count it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = SubscriptionWorld::build('closed@kitchen.test', perDayMinor: 2000, days: 20);
    $this->subscriptions = app(SubscriptionService::class);

    /** Write the branch's week, shut on the given ISO weekday and open on the rest. */
    $this->closeOn = function (int $closed): void {
        foreach ([1, 2, 3, 4, 5, 6, 7] as $weekday) {
            $open = $weekday !== $closed;

            BranchOpeningHour::withoutTenancy()->create([
                'organisation_id' => $this->world->organisation->getKey(),
                'branch_id' => $this->world->branch->getKey(),
                'weekday' => $weekday,
                'opens_at' => $open ? '09:00:00' : null,
                'closes_at' => $open ? '18:00:00' : null,
                'order_cut_off_at' => null,
            ]);
        }
    };
});

afterEach(function (): void {
    CarbonImmutable::setTestNow();
});

it('refuses a delivery day the kitchen is shut on, and takes the rest', function (): void {
    ($this->closeOn)(7);

    try {
        $this->subscriptions->create(SubscriptionWorld::request($this->world));
        $this->fail('A Sunday delivery was accepted from a kitchen shut on Sundays.');
    } catch (SubscriptionRefused $refusal) {
        expect($refusal->details['reasons'])->toContain(['reason' => 'kitchen_closed', 'weekdays' => [7]]);
    }

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world, weekdays: [1, 2, 3, 4, 5, 6]));

    expect($subscription->weekdays)->toBe([1, 2, 3, 4, 5, 6]);
});

it('does not offer a shut day to the subscribe screen', function (): void {
    ($this->closeOn)(7);

    $quote = app(StorefrontQuoting::class)->quote(
        (string) $this->world->plan->getKey(),
        (string) $this->world->configuration->getKey(),
        20,
    );

    expect($quote['available_weekdays'])->toBe([1, 2, 3, 4, 5, 6]);
});

it('skips a shut day without spending it, on a subscription that names no branch', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));
    $subscription->forceFill(['branch_id' => null])->save();

    // The kitchen shuts on the first delivery's weekday after the customer chose it.
    $first = $subscription->next_generation_date;
    ($this->closeOn)($first->dayOfWeekIso);

    // Just past that day's cut-off. Not "a day later": with no branch the deadline is read in the
    // app's zone rather than the branch's the start date was chosen in, so at some hours a day on
    // is still before it.
    CarbonImmutable::setTestNow(app(ChangeWindow::class)->deadlineFor($subscription->refresh(), $first)->addMinute());

    expect(app(GenerationService::class)->tick())->toMatchArray(['generated' => 0, 'skipped' => 1]);

    $delivery = SubscriptionDelivery::query()->where('subscription_id', $subscription->getKey())->sole();

    expect($delivery->status)->toBe(SubscriptionDeliveryStatus::SkippedUnavailable)
        ->and($delivery->consumed)->toBeFalse()
        ->and(Order::query()->count())->toBe(0)
        ->and($subscription->refresh()->balance_days_consumed)->toBe(0);
});

it('does not forecast a shut day', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));
    ($this->closeOn)(7);

    $from = $subscription->next_generation_date;
    $rows = app(ScheduleProjection::class)->forOrganisation(
        (string) $this->world->organisation->getKey(),
        $from,
        $from->addDays(13),
    );

    $weekdays = array_map(static fn (array $row): int => CarbonImmutable::parse($row['delivery_date'])->dayOfWeekIso, $rows);

    // Two weeks of every-day deliveries, less the two Sundays.
    expect($rows)->toHaveCount(12)
        ->and($weekdays)->not->toContain(7);
});
