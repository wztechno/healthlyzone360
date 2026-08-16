<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Orders\Services\PriceOverride;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| The plan menu, as generation sees it
|--------------------------------------------------------------------------
|
| `plan_menu_entries` closed the gap four docblocks had been recording: what a
| fixed-menu plan serves, on which day of its cycle. This is the suite for the
| consequence that actually changes a customer's box — `fillFromPlanMenu()`
| writing `kitchen_default` choice rows before the allergen gate reads them.
|
| Four properties carry the file, and each could regress on its own:
|
|  1. **A plan with no menu generates exactly what it generated yesterday.**
|     This is the load-bearing one. `menu_cycle_days IS NULL` is the whole
|     signal, and every plan on the platform is in that state until its kitchen
|     publishes a menu. A regression here is a silent change to every existing
|     subscription, so it is asserted at the row level: same lines, and no
|     choice rows at all.
|  2. **A plan with a menu generates the food.** Meal lines at zero, source
|     `kitchen_default` on the ledger — and, because a meal line is a line like
|     any other, **stock actually moves when the kitchen confirms**. That last
|     one is the per-plan cut-over the migration docblock warns about (H1), and
|     it is why this file reaches across into Recipes, Ingredients and
|     Inventory: a test that stopped at "a meal line exists" would not have
|     proved the thing the warning is about.
|  3. **The customer beats the kitchen.** A slot they chose keeps their dish;
|     `insertOrIgnore` and the unique index are what decide it, with no
|     read-then-write window in between.
|  4. **A withdrawn dish fills nothing.** The slot is left exactly as a
|     menu-less day leaves it rather than packing food the kitchen has taken off
|     sale — and generation completes rather than throwing.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = SubscriptionWorld::build('menu@kitchen.test', perDayMinor: 2000, days: 20);
    $this->subscriptions = app(SubscriptionService::class);
    $this->generation = app(GenerationService::class);

    /**
     * A published, orderable dish of this kitchen — the shape a menu entry
     * needs.
     *
     * Offered on the world's channel because a composed order's meal line is
     * probed exactly as a basket's is: an unoffered article is refused even
     * when the price is overridden. Priced as well, because a *substitution*
     * candidate is probed with no override at all, and an unpriced dish is not
     * orderable — a dish a real kitchen sells has both.
     */
    $this->dish = function (string $nameEn): CatalogueItem {
        $meal = CheckoutWorld::publishedMeal($this->world->tenant, $nameEn);
        CheckoutWorld::offer($this->world->channel, $meal);
        PricingWorld::price($this->world->priceList, $meal, null, 1500);

        return $meal;
    };

    /**
     * Give a dish an allergen basis, so a customer who has declared an allergy
     * may be sent it.
     *
     * A published recipe version with an empty frozen label is what
     * `DerivedAllergenService` reads as `basis = recipe_version` and no
     * allergens — assessed, and assessed clean. Without one the dish reports
     * `basis = none`, which is "not assessed" rather than "no allergens", and
     * `MealSafety` refuses it for any customer who has declared anything.
     */
    $this->assessed = function (CatalogueItem $dish): CatalogueItem {
        $recipe = Recipe::factory()->create(['organisation_id' => $this->world->organisation->getKey()]);

        RecipeVersion::factory()->published()->create([
            'recipe_id' => $recipe->getKey(),
            'organisation_id' => $this->world->organisation->getKey(),
        ]);

        $dish->recipe_id = $recipe->getKey();
        $dish->save();

        return $dish;
    };

    /**
     * Publish a menu on the world's plan: entries as `[cycleDay, slot, dish]`,
     * anchored so that `$anchor` is day 1.
     *
     * Written as rows rather than through `PUT /catalogue/plans/{item}/menu`
     * because what is under test is what generation does with a published menu,
     * not the publishing — which `PlanMenuTest` covers end to end.
     *
     * @param  list<array{0: int, 1: string, 2: CatalogueItem}>  $entries
     */
    $this->publishMenu = function (array $entries, CarbonImmutable $anchor, int $cycleDays = 7): void {
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
                'menu_cycle_anchor_date' => $anchor->toDateString(),
            ]);
    };

    /** Run something with the seller's tenant context resolved, as a controller would. */
    $this->asSeller = function (callable $work): mixed {
        app(TenantContext::class)->setOrganisation(
            (string) $this->world->tenant->user->getKey(),
            (string) $this->world->organisation->getKey(),
        );

        try {
            return $work();
        } finally {
            app(TenantContext::class)->clear();
        }
    };
});

afterEach(function (): void {
    CarbonImmutable::setTestNow();
    app(TenantContext::class)->clear();
});

/*
| 1. The regression that matters most: a plan with no menu is untouched
*/

it('generates a menu-less plan exactly as it did before there was a menu table', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect($this->generation->tick()['generated'])->toBe(1);

    $order = Order::query()->sole();
    $lines = $order->lines()->get();

    // One line: the plan day, at the captured price. No meal line, because the
    // kitchen has not said what it serves — the behaviour every plan on the
    // platform has until its menu is published.
    expect($lines)->toHaveCount(1)
        ->and($lines->first()->catalogue_item_id)->toBe((string) $this->world->plan->getKey())
        ->and($lines->first()->price_source)->toBe(PriceOverride::SUBSCRIPTION_CAPTURE)
        ->and($lines->first()->unit_price_minor)->toBe(2000);

    // And not one choice row was invented. `fillFromPlanMenu()` returns on the
    // null cycle before writing anything at all.
    expect(SubscriptionMealChoice::query()->count())->toBe(0);
});

/*
| 2. A published menu: the food, the ledger, and the stock
*/

it('fills the day from the plan menu, prices the food at zero, and records who chose it', function (): void {
    $chicken = ($this->dish)('Grilled chicken');
    $soup = ($this->dish)('Red lentil soup');

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));
    $date = $subscription->next_generation_date;

    // Anchored on the delivery date, so that day is day 1 of the cycle — and
    // day 2 carries a dish that must not appear in this day's box.
    ($this->publishMenu)([
        [1, 'lunch', $chicken],
        [1, 'dinner', $soup],
        [2, 'lunch', $soup],
    ], $date);

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect($this->generation->tick()['generated'])->toBe(1);

    $choices = SubscriptionMealChoice::query()
        ->where('subscription_id', $subscription->getKey())
        ->orderBy('slot')
        ->get();

    // Two rows — day 1's two sittings, and not day 2's lunch — each stamped
    // with the provenance a complaint would be answered from.
    expect($choices)->toHaveCount(2)
        ->and($choices->pluck('source')->unique()->all())->toBe([MealChoiceSource::KitchenDefault])
        ->and($choices->pluck('slot')->all())->toBe(['dinner', 'lunch'])
        ->and($choices->firstWhere('slot', 'lunch')->catalogue_item_id)->toBe((string) $chicken->getKey())
        ->and($choices->firstWhere('slot', 'dinner')->catalogue_item_id)->toBe((string) $soup->getKey())
        // The allergen gate ran over them exactly as it does over a customer's
        // own rows: same door, no second one.
        ->and($choices->every(fn ($choice): bool => $choice->safety_checked_at !== null))->toBeTrue();

    $order = Order::query()->sole();
    $lines = $order->lines()->get();

    expect($lines)->toHaveCount(3);

    $mealLines = $lines->whereNotIn('catalogue_item_id', [(string) $this->world->plan->getKey()]);

    expect($mealLines)->toHaveCount(2)
        ->and($mealLines->pluck('unit_price_minor')->unique()->all())->toBe([0])
        ->and($mealLines->pluck('line_total_minor')->unique()->all())->toBe([0])
        ->and($mealLines->pluck('price_source')->unique()->all())->toBe([PriceOverride::SUBSCRIPTION_INCLUDED])
        // The food is on the order without the subtotal charging for it: the
        // day's price is the plan's, once, and the dishes are what it buys.
        ->and($order->subtotal_minor)->toBe(2000);

    $delivery = SubscriptionDelivery::query()->where('subscription_id', $subscription->getKey())->sole();

    expect($delivery->status)->toBe(SubscriptionDeliveryStatus::Generated)
        ->and($delivery->consumed)->toBeTrue();

    // And the customer's own ledger carries the provenance. `kitchen_default`
    // passed the CHECK and the PHP enum from the day the table shipped, but no
    // row had ever carried it and nothing had ever served it — this is the
    // first, and the wire has to admit it.
    $this->actingAs($this->world->customer->account->user);

    $served = $this->getJson('/api/v1/me/subscriptions/'.$subscription->getKey().'/deliveries', firstPartyHeaders())
        ->assertOk()
        ->json('data.0.meals');

    expect($served)->toHaveCount(2)
        ->and(array_column($served, 'source'))->toBe(['kitchen_default', 'kitchen_default'])
        // The dish's name is resolved server-side, so a customer reading the
        // ledger sees food rather than identifiers.
        ->and(array_column($served, 'name'))->toBe(['Red lentil soup', 'Grilled chicken']);
});

it('deducts real ingredients when the kitchen confirms an order the menu filled', function (): void {
    // The per-plan cut-over, end to end (H1). Before a menu exists a
    // subscription order carries one plan-day line, and a plan-day line moves
    // no stock at all; publishing the menu is what puts food on the order, and
    // food is what the shelf pays for.
    $kilogram = MeasurementUnit::query()->where('code', 'kg')->sole();
    $gram = MeasurementUnit::query()->where('code', 'g')->sole();

    /** @var array{0: StockItem, 1: CatalogueItem} $stocked */
    $stocked = ($this->asSeller)(function () use ($kilogram, $gram): array {
        $ingredient = Ingredient::factory()->create([
            'organisation_id' => $this->world->organisation->getKey(),
            'default_unit_id' => (string) $kilogram->getKey(),
        ]);

        $stockItem = StockItem::query()->create([
            'organisation_id' => $this->world->organisation->getKey(),
            'code' => 'sku-menu-flour',
            'name_en' => 'Menu flour',
            'unit_code' => $kilogram->code,
            'unit_id' => (string) $kilogram->getKey(),
            'ingredient_id' => (string) $ingredient->getKey(),
        ]);

        IngredientStockCost::query()->create([
            'organisation_id' => $this->world->organisation->getKey(),
            'ingredient_id' => (string) $ingredient->getKey(),
            'unit_id' => (string) $kilogram->getKey(),
            'quantity_on_hand' => '100',
            'moving_average_cost_amount' => '2.000000',
            'last_purchase_cost_amount' => '2.000000',
            'currency_code' => 'USD',
        ]);

        app(InventoryService::class)->recordMovement(
            (string) $this->world->organisation->getKey(),
            (string) $this->world->branch->getKey(),
            (string) $stockItem->getKey(),
            'receipt',
            '100',
        );

        $recipe = Recipe::factory()->create(['organisation_id' => $this->world->organisation->getKey()]);

        $version = RecipeVersion::factory()->published()->create([
            'recipe_id' => $recipe->getKey(),
            'organisation_id' => $this->world->organisation->getKey(),
            'yield_piece_count' => 5,
            'waste_coefficient_percent' => '0.00',
        ]);

        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $this->world->organisation->getKey(),
            'line_number' => 1,
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => '250',
            'unit_id' => (string) $gram->getKey(),
        ]);

        $dish = ($this->dish)('Flatbread plate');
        $dish->recipe_id = $recipe->getKey();
        $dish->save();

        return [$stockItem, $dish];
    });

    [$stockItem, $dish] = $stocked;

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    ($this->publishMenu)([[1, 'lunch', $dish]], $subscription->next_generation_date);

    // Generation runs with no ambient tenant — it is an hourly job, and this is
    // the shape it actually runs in.
    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());
    expect($this->generation->tick()['generated'])->toBe(1);

    $order = Order::query()->sole();

    expect((string) StockLevel::withoutTenancy()->where('stock_item_id', $stockItem->getKey())->value('quantity'))
        // Nothing has moved yet. Placing an order commits no food; confirming
        // one does.
        ->toBe('100.0000');

    ($this->asSeller)(fn () => app(OrderLifecycle::class)->confirm($order, $order->lock_version));

    // 250 g ÷ 5 pieces = 50 g = 0.05 kg, once, for the one meal on the day.
    expect((string) StockLevel::withoutTenancy()->where('stock_item_id', $stockItem->getKey())->value('quantity'))
        ->toBe('99.9500');
});

/*
| 3. The customer beats the default
*/

it('leaves a slot the customer chose alone, and fills only the ones they did not', function (): void {
    $kitchensChoice = ($this->dish)('Kitchen lunch');
    $customersChoice = ($this->dish)('Customer lunch');
    $kitchensDinner = ($this->dish)('Kitchen dinner');

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));
    $date = $subscription->next_generation_date;

    ($this->publishMenu)([
        [1, 'lunch', $kitchensChoice],
        [1, 'dinner', $kitchensDinner],
    ], $date);

    SubscriptionMealChoice::query()->create([
        'subscription_id' => $subscription->getKey(),
        'organisation_id' => $subscription->organisation_id,
        'delivery_date' => $date,
        'slot' => 'lunch',
        'sequence' => 1,
        'catalogue_item_id' => $customersChoice->getKey(),
        'source' => MealChoiceSource::Customer,
    ]);

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect($this->generation->tick()['generated'])->toBe(1);

    $choices = SubscriptionMealChoice::query()
        ->where('subscription_id', $subscription->getKey())
        ->orderBy('slot')
        ->get();

    // Two rows, not three: the unique index absorbed the default at the
    // coordinate the customer had already taken, and left the one they had not.
    expect($choices)->toHaveCount(2);

    $lunch = $choices->firstWhere('slot', 'lunch');
    $dinner = $choices->firstWhere('slot', 'dinner');

    expect($lunch->catalogue_item_id)->toBe((string) $customersChoice->getKey())
        ->and($lunch->source)->toBe(MealChoiceSource::Customer)
        ->and($dinner->catalogue_item_id)->toBe((string) $kitchensDinner->getKey())
        ->and($dinner->source)->toBe(MealChoiceSource::KitchenDefault);

    // And it is the customer's dish that is on the order.
    $items = Order::query()->sole()->lines()->pluck('catalogue_item_id')->all();

    expect($items)->toContain((string) $customersChoice->getKey())
        ->and($items)->not->toContain((string) $kitchensChoice->getKey());
});

/*
| 4. The dish the kitchen has withdrawn
*/

it('leaves the slot unfilled when the menu names a dish that has since been retired', function (): void {
    $retired = ($this->dish)('Withdrawn dish');
    $stillSold = ($this->dish)('Everyday dish');

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    ($this->publishMenu)([
        [1, 'lunch', $retired],
        [1, 'dinner', $stillSold],
    ], $subscription->next_generation_date);

    // The menu was legal when it was written — the service refuses an
    // unpublished dish — and the kitchen has since taken this one off sale.
    CatalogueItem::withoutTenancy()->whereKey($retired->getKey())->update(['status' => 'retired']);

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    // Generation completes: a withdrawn dish is a slot nobody filled, not a
    // failure. The day is still delivered and the balance still spent.
    expect($this->generation->tick())->toMatchArray(['generated' => 1, 'skipped' => 0]);

    $choices = SubscriptionMealChoice::query()->where('subscription_id', $subscription->getKey())->get();

    expect($choices)->toHaveCount(1)
        ->and($choices->sole()->slot)->toBe('dinner')
        ->and($choices->sole()->catalogue_item_id)->toBe((string) $stillSold->getKey());

    $items = Order::query()->sole()->lines()->pluck('catalogue_item_id')->all();

    expect($items)->not->toContain((string) $retired->getKey())
        ->and($items)->toContain((string) $stillSold->getKey())
        ->and($items)->toHaveCount(2);
});

/*
| 5. A default that is not safe goes through the substitution path unchanged
*/

it('substitutes an unsafe kitchen default from the plan menu, and only from the plan menu', function (): void {
    $allergen = Allergen::factory()->create(['code' => 'peanuts']);
    SubscriptionWorld::declareAllergen($this->world, $allergen->code);

    // `$unsafe` is unassessed, which is the honest unsafe case: the customer
    // declared an allergy and nobody has ever assessed the dish. `$safe` sits
    // on the menu too, so the repertoire has somewhere to send them.
    $unsafe = ($this->dish)('Unassessed lunch');
    $safe = ($this->assessed)(($this->dish)('Assessed lunch'));

    // A published, orderable, assessed dish this kitchen sells that is **not**
    // on the plan's menu. Before the menu existed it was a legal substitute —
    // it sorts first by name, so a finder that had not narrowed would pick it.
    // It is not a candidate now.
    $offMenu = ($this->assessed)(($this->dish)('Aa off-menu lunch'));

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    ($this->publishMenu)([
        [1, 'lunch', $unsafe],
        [2, 'lunch', $safe],
    ], $subscription->next_generation_date);

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect($this->generation->tick()['generated'])->toBe(1);

    $choice = SubscriptionMealChoice::query()->where('subscription_id', $subscription->getKey())->sole();

    // The row the default wrote was rewritten in place, and it says so: a
    // complaint is answered from `source` plus `replaced_catalogue_item_id`.
    expect($choice->source)->toBe(MealChoiceSource::Substituted)
        ->and($choice->replaced_catalogue_item_id)->toBe((string) $unsafe->getKey())
        // Drawn from the plan's own repertoire — the other cycle day's dish —
        // rather than from anything else the kitchen happens to publish.
        ->and($choice->catalogue_item_id)->toBe((string) $safe->getKey())
        ->and($choice->catalogue_item_id)->not->toBe((string) $offMenu->getKey());
});
