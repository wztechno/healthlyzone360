<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionEvent;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;

/*
|--------------------------------------------------------------------------
| No safe meal means no delivery — and no balance day spent
|--------------------------------------------------------------------------
|
| §6, and the only rule in S1 with no exceptions: automatic substitution never
| violates a customer's allergen declarations, and "if no safe substitute
| exists, the delivery for that slot is skipped WITHOUT consuming a balance day
| and the customer is notified."
|
| The unsafe verdict here is `unassessed`, which is the honest and the dangerous
| case at once: the customer has declared an allergy and the kitchen's dish has
| no allergen basis at all. `DerivedAllergenService` reports `basis = none` for
| such an item, and "not assessed" is not "no allergens" — the rule the recipe
| publication gate is built on. A platform that shipped the dish anyway would be
| treating silence as a safety claim.
|
| Three things are asserted because a regression could break any one of them
| independently: no order is placed, no balance day is spent, and an event is
| written for the notification layer to read. The second is the one that would
| go unnoticed.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = SubscriptionWorld::build('allergy@kitchen.test');
    $this->subscriptions = app(SubscriptionService::class);
    $this->generation = app(GenerationService::class);
});

it('skips the day without spending a balance day when nothing safe can be sent', function (): void {
    $allergen = Allergen::factory()->create(['code' => 'peanuts']);

    SubscriptionWorld::declareAllergen($this->world, $allergen->code);

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));
    $date = $subscription->next_generation_date;

    // The customer chose their lunch ahead of the cut-off (§7). The dish is a
    // published, orderable meal — and nobody has ever assessed it.
    SubscriptionMealChoice::query()->create([
        'subscription_id' => $subscription->getKey(),
        'organisation_id' => $subscription->organisation_id,
        'delivery_date' => $date,
        'slot' => 'lunch',
        'sequence' => 1,
        'catalogue_item_id' => $this->world->meal->getKey(),
        'source' => MealChoiceSource::Customer,
    ]);

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    $tally = $this->generation->tick();

    expect($tally['generated'])->toBe(0)
        ->and($tally['skipped'])->toBe(1)
        // No order at all. The alternative — sending the plan-day line without
        // the food — would charge for a delivery nobody could eat.
        ->and(Order::query()->count())->toBe(0);

    $delivery = SubscriptionDelivery::query()
        ->where('subscription_id', $subscription->getKey())
        ->whereDate('delivery_date', $date->toDateString())
        ->firstOrFail();

    expect($delivery->status)->toBe(SubscriptionDeliveryStatus::SkippedNoSafeMeal)
        ->and($delivery->skip_reason)->toBe('no_safe_meal')
        // The promise, in one column.
        ->and($delivery->consumed)->toBeFalse()
        ->and($subscription->refresh()->balance_days_consumed)->toBe(0)
        ->and($subscription->remainingDays())->toBe(20);

    // And the customer can be told. Nothing here sends anything; the event is
    // what a notification layer reads, and it outlives audit retention.
    expect(SubscriptionEvent::query()
        ->where('subscription_id', $subscription->getKey())
        ->where('event_type', 'no_safe_meal')
        ->exists())->toBeTrue();

    CarbonImmutable::setTestNow();
});
