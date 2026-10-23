<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Subscriptions\Services\SubscriptionProjection;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;

/*
|--------------------------------------------------------------------------
| A skipped day is not a delivery, and nothing may point at it
|--------------------------------------------------------------------------
|
| Three readers used to disagree about a day the customer had skipped before
| it was generated. `starts_on` took the earliest row in the ledger, and a skip
| is a row, so skipping day four moved the start to day four. The cursor —
| `next_delivery_date` on the wire — stayed where it was, so skipping the next
| day told the customer their next delivery was the one they had just
| declined. And a resume walked the weekday pattern without looking at the
| ledger, so it could land the cursor back on a skipped day.
|
| One fact underlies all three: a skipped or cancelled row is the *absence* of
| a delivery. `DeliveryCursor` is where that is now stated, and these tests pin
| each reader to it.
|
| The fourth test is the purchase-side half. The quote says where a pattern
| could start; a purchase asking for an earlier day is refused by name rather
| than moved to a day the customer never agreed to.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = SubscriptionWorld::build('skips@kitchen.test', perDayMinor: 2000, days: 20);
    $this->subscriptions = app(SubscriptionService::class);
    $this->projection = app(SubscriptionProjection::class);
});

it('keeps starts_on where it was when a later day is skipped before any generation', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    $first = $subscription->next_generation_date;

    expect($first)->not->toBeNull()
        ->and($this->projection->for($subscription)['started_on'])->toBe($first->toDateString());

    // Four days out: outside the window, and a day the subscription delivers
    // on because it delivers on all seven. The skip is the only row in the
    // ledger, and a reader that took "the earliest row" for the start would
    // now say the subscription starts on the day nothing is coming.
    $this->subscriptions->skip($subscription, $first->addDays(3));

    expect($this->projection->for($subscription->refresh())['started_on'])->toBe($first->toDateString())
        ->and($subscription->next_generation_date->toDateString())->toBe($first->toDateString());
});

it('moves the cursor off a skipped day, so next_delivery_date is a day food is coming', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    $first = $subscription->next_generation_date;

    $this->subscriptions->skip($subscription, $first);

    $subscription->refresh();

    // Every day is a delivery day, so the day after is the next one.
    expect($subscription->next_generation_date->toDateString())->toBe($first->addDay()->toDateString())
        ->and($this->subscriptions->balance($subscription)['next_delivery_date'])->toBe($first->addDay()->toDateString())
        // Nothing was spent: a skip is free whatever it does to the cursor.
        ->and($subscription->balance_days_consumed)->toBe(0)
        // And the start follows the cursor, because the skipped day was never
        // a delivery.
        ->and($this->projection->for($subscription)['started_on'])->toBe($first->addDay()->toDateString());
});

it('resumes onto the first day the customer has not already skipped', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    $first = $subscription->next_generation_date;

    // Two skips in a row, each moving the cursor one day on.
    $this->subscriptions->skip($subscription, $first);
    $this->subscriptions->skip($subscription->refresh(), $first->addDay());

    expect($subscription->refresh()->next_generation_date->toDateString())->toBe($first->addDays(2)->toDateString());

    $this->subscriptions->pause($subscription);

    expect($subscription->status)->toBe(SubscriptionStatus::Paused)
        ->and($subscription->next_generation_date)->toBeNull();

    // A resume walks forward from today. Without the ledger it would stop on
    // `$first` — still open, still a delivery weekday — and name as the next
    // delivery a day the customer said not to come.
    $resumed = $this->subscriptions->resume($subscription);

    expect($resumed->status)->toBe(SubscriptionStatus::Active)
        ->and($resumed->next_generation_date->toDateString())->toBe($first->addDays(2)->toDateString());
});

it('quotes the earliest start and refuses a purchase that asks for an earlier day', function (): void {
    $this->actingAs($this->world->customer->account->user);

    $coordinates = [
        'catalogue_item_id' => (string) $this->world->plan->getKey(),
        'catalogue_item_variant_id' => (string) $this->world->configuration->getKey(),
        'plan_duration_days' => $this->world->duration->duration_days,
    ];

    // Every weekday: the earliest start is the first day outside the 24-hour
    // window, which is what a purchase on the same pattern lands on. Asked on
    // the same branch the purchase names, because the window is judged on that
    // branch's clock — around midnight a UTC quote and a branch purchase can
    // fall on different calendar days.
    $everyDay = $this->getJson('/api/v1/subscriptions/quote?'.http_build_query($coordinates + [
        'branch_id' => (string) $this->world->branch->getKey(),
    ]), firstPartyHeaders())
        ->assertOk()
        ->json('data.quote.earliest_start_date');

    $reference = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    expect($everyDay)->toBe($reference->next_generation_date->toDateString());

    // One weekday, three days out — outside the window, so the earliest start
    // is that day and not the one the full pattern reached first.
    $target = CarbonImmutable::now()->addDays(3)->startOfDay();

    $this->getJson('/api/v1/subscriptions/quote?'.http_build_query($coordinates + [
        'weekdays' => [$target->dayOfWeekIso],
        'branch_id' => (string) $this->world->branch->getKey(),
    ]), firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.quote.earliest_start_date', $target->toDateString());

    $purchase = [
        'sales_channel_id' => (string) $this->world->channel->getKey(),
        'branch_id' => (string) $this->world->branch->getKey(),
        'catalogue_item_id' => (string) $this->world->plan->getKey(),
        'catalogue_item_variant_id' => (string) $this->world->configuration->getKey(),
        'plan_duration_id' => (string) $this->world->duration->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
        'weekdays' => [1, 2, 3, 4, 5, 6, 7],
    ];

    // Today is always inside a 24-hour window on itself. Refused on the field,
    // naming the day that would have been accepted, with the window's own
    // reason beside it — not quietly started on a different day.
    $this->postJson('/api/v1/subscriptions', $purchase + ['start_from' => CarbonImmutable::now()->toDateString()], firstPartyHeaders())
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.fields.start_from.0', 'The earliest start for this plan is '.$everyDay.'.')
        ->assertJsonPath('error.details.reasons.0.reason', 'inside_cut_off')
        ->assertJsonPath('error.details.reasons.0.effective_from', $everyDay);

    // The day the quote named is accepted as asked.
    $this->postJson('/api/v1/subscriptions', $purchase + ['start_from' => $everyDay], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.subscription.next_delivery_date', $everyDay)
        ->assertJsonPath('data.subscription.starts_on', $everyDay);
});
