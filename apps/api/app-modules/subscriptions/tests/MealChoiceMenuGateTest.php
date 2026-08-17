<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Exceptions\SubscriptionChangeRefused;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Services\MealChoiceService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;
use Healthy360\Support\Identifiers\IdentifierService;

/*
|--------------------------------------------------------------------------
| Choosing ahead, once the plan has a menu
|--------------------------------------------------------------------------
|
| Two consequences of `plan_menu_entries` land on the writer rather than on
| generation, and they pull in opposite directions — one narrows what a customer
| may choose, the other widens what their choice may overwrite.
|
|  1. **`meal_not_on_plan_menu`.** A plan that publishes a menu has stated its
|     repertoire, and a dish outside it is not a dish that plan serves. The check
|     asks about the repertoire and not about the chosen day — see
|     `MealChoiceService::mealReasons()` for the three arguments that settled
|     that, of which the first is decisive: this service only runs on a plan that
|     allows free selection, so narrowing a choice to the day's own entry would
|     let a customer choose exactly what they would have been sent anyway.
|
|     A plan with **no** menu keeps exactly three checks. Most plans on the
|     platform are in that state and must stay choosable.
|
|  2. **The widened delete (H9).** Generation now writes `kitchen_default` rows
|     at the same `(subscription, date, slot, sequence)` coordinates a customer's
|     choice occupies. A `PUT` that cleared only `customer` rows would collide
|     with the index and surface as a raw 500. The default yields to the person;
|     the substitution audit does not yield to anybody.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = SubscriptionWorld::build('choices@kitchen.test');
    $this->choices = app(MealChoiceService::class);
    $this->subscription = app(SubscriptionService::class)->create(SubscriptionWorld::request($this->world));

    // The first delivery still outside the change window — the day a customer
    // may still choose for.
    $this->date = $this->subscription->next_generation_date;

    $this->dish = function (string $nameEn): CatalogueItem {
        $meal = CheckoutWorld::publishedMeal($this->world->tenant, $nameEn);
        CheckoutWorld::offer($this->world->channel, $meal);

        return $meal;
    };

    /** @param  list<array{0: int, 1: string, 2: CatalogueItem}>  $entries */
    $this->publishMenu = function (array $entries, int $cycleDays = 7): void {
        foreach ($entries as $index => [$cycleDay, $slot, $dish]) {
            PlanMenuEntry::factory()->create([
                'organisation_id' => $this->world->organisation->getKey(),
                'catalogue_item_id' => $this->world->plan->getKey(),
                'cycle_day' => $cycleDay,
                'slot' => $slot,
                'sequence' => $index + 1,
                'meal_catalogue_item_id' => $dish->getKey(),
            ]);
        }

        SubscriptionPlanProfile::withoutTenancy()
            ->whereKey($this->world->plan->getKey())
            ->update([
                'menu_cycle_days' => $cycleDays,
                'menu_cycle_anchor_date' => $this->date->toDateString(),
            ]);
    };

    $this->choose = fn (CatalogueItem $dish, string $slot = 'lunch', int $sequence = 1): array => [[
        'slot' => $slot,
        'sequence' => $sequence,
        'catalogue_item_id' => (string) $dish->getKey(),
    ]];

    /** @return list<string> the refusal codes, in order */
    $this->refusalCodes = function (callable $work): array {
        try {
            $work();
        } catch (SubscriptionChangeRefused $refused) {
            /** @var list<array<string, mixed>> $reasons */
            $reasons = $refused->details['reasons'] ?? [];

            return array_map(static fn (array $reason): string => (string) $reason['reason'], $reasons);
        }

        return [];
    };
});

afterEach(function (): void {
    CarbonImmutable::setTestNow();
});

/*
| 1. Free selection with no menu: three checks, exactly as before
*/

it('keeps a menu-less plan choosable and asks it exactly three questions', function (): void {
    $published = ($this->dish)('Anything at all');

    $written = $this->choices->replace($this->subscription, $this->date, ($this->choose)($published));

    expect($written)->toHaveCount(1)
        ->and($written->first()->catalogue_item_id)->toBe((string) $published->getKey())
        ->and($written->first()->source)->toBe(MealChoiceSource::Customer);

    // The three the service has always asked, still asked, and no fourth: a
    // plan that has published no menu has no repertoire to be outside of.
    $retired = ($this->dish)('Withdrawn');
    CatalogueItem::withoutTenancy()->whereKey($retired->getKey())->update(['status' => 'retired']);

    expect(($this->refusalCodes)(fn () => $this->choices->replace(
        $this->subscription,
        $this->date,
        ($this->choose)($retired->refresh()),
    )))->toBe(['meal_not_published']);

    expect(($this->refusalCodes)(fn () => $this->choices->replace(
        $this->subscription,
        $this->date,
        ($this->choose)($this->world->plan),
    )))->toBe(['meal_not_a_meal']);

    expect(($this->refusalCodes)(fn () => $this->choices->replace($this->subscription, $this->date, [[
        'slot' => 'lunch',
        'sequence' => 1,
        'catalogue_item_id' => app(IdentifierService::class)->generate(),
    ]])))->toBe(['meal_unknown']);
});

/*
| 2. Free selection on a plan that has published a menu
*/

it('refuses a dish the plan does not serve once the plan has said what it serves', function (): void {
    $onMenu = ($this->dish)('On the menu');
    $offMenu = ($this->dish)('Sold, but not on this plan');

    ($this->publishMenu)([[1, 'lunch', $onMenu]]);

    // The dish the kitchen sells to everybody, which this plan does not serve.
    expect(($this->refusalCodes)(fn () => $this->choices->replace(
        $this->subscription,
        $this->date,
        ($this->choose)($offMenu),
    )))->toBe(['meal_not_on_plan_menu']);

    // And the dish the plan does serve is accepted.
    expect($this->choices->replace($this->subscription, $this->date, ($this->choose)($onMenu))->first()->catalogue_item_id)
        ->toBe((string) $onMenu->getKey());
});

it('accepts a dish from any day of the cycle, not only the chosen date', function (): void {
    // The repertoire reading, made concrete. `$this->date` is day 1 of the
    // cycle; the customer picks the dish the kitchen cooks on day 4. Refusing
    // that would mean refusing tomorrow's dish chosen today, and a customer
    // reading a plan sees the rotation rather than one day of it.
    $dayOne = ($this->dish)('Monday lunch');
    $dayFour = ($this->dish)('Thursday lunch');

    ($this->publishMenu)([
        [1, 'lunch', $dayOne],
        [4, 'dinner', $dayFour],
    ]);

    $written = $this->choices->replace($this->subscription, $this->date, ($this->choose)($dayFour));

    expect($written)->toHaveCount(1)
        ->and($written->first()->catalogue_item_id)->toBe((string) $dayFour->getKey());
});

it('reports every refusal a single dish earns, rather than only the first', function (): void {
    $offMenuAndRetired = ($this->dish)('Withdrawn and off-menu');

    ($this->publishMenu)([[1, 'lunch', ($this->dish)('The only thing on it')]]);

    CatalogueItem::withoutTenancy()->whereKey($offMenuAndRetired->getKey())->update(['status' => 'retired']);

    expect(($this->refusalCodes)(fn () => $this->choices->replace(
        $this->subscription,
        $this->date,
        ($this->choose)($offMenuAndRetired->refresh()),
    )))->toBe(['meal_not_published', 'meal_not_on_plan_menu']);
});

/*
| 3. H9 — the customer's choice lands on top of the kitchen's default
*/

it('lets a customer overwrite the kitchen default at the same slot without hitting the unique index', function (): void {
    $kitchens = ($this->dish)('What the kitchen would have sent');
    $customers = ($this->dish)('What they would rather have');
    $wasUnsafe = ($this->dish)('Substituted for something else');

    // The row generation writes from the plan menu, at exactly the coordinate a
    // customer's own choice occupies.
    SubscriptionMealChoice::query()->create([
        'subscription_id' => $this->subscription->getKey(),
        'organisation_id' => $this->subscription->organisation_id,
        'delivery_date' => $this->date,
        'slot' => 'lunch',
        'sequence' => 1,
        'catalogue_item_id' => $kitchens->getKey(),
        'source' => MealChoiceSource::KitchenDefault,
    ]);

    // And a substitution audit on another sitting of the same day, which must
    // survive whatever the customer does to their lunch.
    SubscriptionMealChoice::query()->create([
        'subscription_id' => $this->subscription->getKey(),
        'organisation_id' => $this->subscription->organisation_id,
        'delivery_date' => $this->date,
        'slot' => 'dinner',
        'sequence' => 1,
        'catalogue_item_id' => $wasUnsafe->getKey(),
        'replaced_catalogue_item_id' => (string) $kitchens->getKey(),
        'source' => MealChoiceSource::Substituted,
    ]);

    $written = $this->choices->replace($this->subscription, $this->date, ($this->choose)($customers));

    // No unique violation, and the person won: the default was cleared, not
    // collided with.
    $rows = SubscriptionMealChoice::query()
        ->where('subscription_id', $this->subscription->getKey())
        ->orderBy('slot')
        ->get();

    expect($rows)->toHaveCount(2)
        ->and($rows->firstWhere('slot', 'lunch')->catalogue_item_id)->toBe((string) $customers->getKey())
        ->and($rows->firstWhere('slot', 'lunch')->source)->toBe(MealChoiceSource::Customer)
        // The one audit an allergy complaint needs most is untouched.
        ->and($rows->firstWhere('slot', 'dinner')->source)->toBe(MealChoiceSource::Substituted)
        ->and($rows->firstWhere('slot', 'dinner')->replaced_catalogue_item_id)->toBe((string) $kitchens->getKey())
        // And what comes back is the whole day, substitution included.
        ->and($written)->toHaveCount(2);
});
