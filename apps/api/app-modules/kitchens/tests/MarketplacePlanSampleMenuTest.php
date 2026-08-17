<?php

declare(strict_types=1);

use Database\Seeders\DatabaseSeeder;
use Database\Seeders\MarketplaceKitchensSeeder;
use Database\Seeders\MarketplacePlansSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Kitchens\Services\MarketplacePlans;

/*
|--------------------------------------------------------------------------
| sample_meal_ids — the plan's own menu, on the public surface
|--------------------------------------------------------------------------
|
| The field shipped as a documented `[]`: no table linked a plan to the meals a
| representative week would contain, and assembling one from the kitchen's
| catalogue would have been the platform writing a menu. `plan_menu_entries`
| now exists, so the field carries what the kitchen wrote — and the argument
| survives intact, because the identifiers are read rather than composed.
|
| Three things are worth pinning, in the order a regression would break them:
|
|  1. **A plan with no menu still answers `[]`.** Every preview plan is in that
|     state, the client already renders it as one, and a plan whose kitchen has
|     not said what it serves must not start claiming a week.
|  2. **The order is the kitchen's** — cycle day, then the sitting's place in
|     the day, then sequence. Alphabetical slot order would print `breakfast,
|     dinner, lunch, snack`, which is not a day.
|  3. **Published dishes only, and a sample rather than the menu.** A withdrawn
|     dish is omitted rather than advertised, and a long cycle does not publish
|     a kitchen's whole repertoire on a marketing card.
|
*/

beforeEach(function (): void {
    $this->seed(DatabaseSeeder::class);
    $this->seed(MarketplaceKitchensSeeder::class);
    $this->seed(MarketplacePlansSeeder::class);

    $this->plan = CatalogueItem::withoutTenancy()
        ->where('item_type', CatalogueItemType::SubscriptionPlan->value)
        ->where('slug', 'balanced-week')
        ->sole();

    /** A published meal in the plan's own kitchen and catalogue. */
    $this->dish = fn (string $nameEn): CatalogueItem => CatalogueItem::factory()->meal()->published()->create([
        'catalogue_id' => $this->plan->catalogue_id,
        'organisation_id' => $this->plan->organisation_id,
        'name_en' => $nameEn,
    ]);

    /** @param  list<array{0: int, 1: string, 2: CatalogueItem}>  $entries */
    $this->publishMenu = function (array $entries, int $cycleDays = 7): void {
        foreach ($entries as $index => [$cycleDay, $slot, $dish]) {
            PlanMenuEntry::factory()->create([
                'organisation_id' => $this->plan->organisation_id,
                'catalogue_item_id' => $this->plan->getKey(),
                'cycle_day' => $cycleDay,
                'slot' => $slot,
                'sequence' => $index + 1,
                'meal_catalogue_item_id' => $dish->getKey(),
            ]);
        }

        SubscriptionPlanProfile::withoutTenancy()
            ->whereKey($this->plan->getKey())
            ->update(['menu_cycle_days' => $cycleDays, 'menu_cycle_anchor_date' => '2026-08-16']);
    };

    $this->served = fn (): array => $this->getJson('/api/v1/marketplace/meal-plans/'.$this->plan->slug)
        ->assertOk()
        ->json('data.sample_meal_ids');
});

it('serves an empty sample for a plan whose kitchen has published no menu', function (): void {
    expect(($this->served)())->toBe([]);

    // And every plan on the public list, which is where a card reads it.
    $plans = collect($this->getJson('/api/v1/marketplace/meal-plans?limit=50')->assertOk()->json('data'));

    expect($plans)->not->toBeEmpty()
        ->and($plans->every(static fn (array $plan): bool => $plan['sample_meal_ids'] === []))->toBeTrue();
});

it('serves the plan menu in the order the kitchen serves it', function (): void {
    $monday = ($this->dish)('Monday lunch');
    $mondayDinner = ($this->dish)('Monday dinner');
    $mondayBreakfast = ($this->dish)('Monday breakfast');
    $tuesday = ($this->dish)('Tuesday lunch');

    // Deliberately written out of order, and with the sittings shuffled: the
    // read is what has to sort them.
    ($this->publishMenu)([
        [2, 'lunch', $tuesday],
        [1, 'dinner', $mondayDinner],
        [1, 'lunch', $monday],
        [1, 'breakfast', $mondayBreakfast],
    ]);

    expect(($this->served)())->toBe([
        (string) $mondayBreakfast->getKey(),
        (string) $monday->getKey(),
        (string) $mondayDinner->getKey(),
        (string) $tuesday->getKey(),
    ]);
});

it('names each dish once however often the cycle serves it', function (): void {
    $staple = ($this->dish)('Every single day');
    $treat = ($this->dish)('Once a week');

    ($this->publishMenu)([
        [1, 'lunch', $staple],
        [2, 'lunch', $staple],
        [3, 'lunch', $staple],
        [4, 'lunch', $treat],
    ]);

    expect(($this->served)())->toBe([(string) $staple->getKey(), (string) $treat->getKey()]);
});

it('omits a dish the kitchen has since withdrawn rather than advertising it', function (): void {
    $sold = ($this->dish)('Still sold');
    $withdrawn = ($this->dish)('No longer sold');

    ($this->publishMenu)([
        [1, 'lunch', $withdrawn],
        [1, 'dinner', $sold],
    ]);

    CatalogueItem::withoutTenancy()
        ->whereKey($withdrawn->getKey())
        ->update(['status' => CatalogueItemStatus::Retired->value]);

    // The consumer meal endpoints serve published items only, so a withdrawn
    // identifier would resolve to nothing on the client and leave a hole in the
    // sample menu. It is filtered at the source instead.
    expect(($this->served)())->toBe([(string) $sold->getKey()]);
});

it('caps the sample, because a sample is not the menu', function (): void {
    $dishes = [];
    $entries = [];

    // A four-week cycle, one lunch a day: twenty-eight distinct dishes, which
    // is a kitchen's repertoire rather than a taste of it.
    foreach (range(1, 28) as $day) {
        $dish = ($this->dish)(sprintf('Day %02d lunch', $day));
        $dishes[] = (string) $dish->getKey();
        $entries[] = [$day, 'lunch', $dish];
    }

    ($this->publishMenu)($entries, cycleDays: 28);

    $served = ($this->served)();

    expect($served)->toHaveCount(MarketplacePlans::SAMPLE_MEAL_LIMIT)
        ->and(MarketplacePlans::SAMPLE_MEAL_LIMIT)->toBe(12)
        // The first twelve of the cycle, not twelve arbitrary ones.
        ->and($served)->toBe(array_slice($dishes, 0, MarketplacePlans::SAMPLE_MEAL_LIMIT));
});
