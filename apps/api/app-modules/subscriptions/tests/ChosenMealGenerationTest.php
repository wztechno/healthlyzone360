<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Orders\Services\PriceOverride;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\MealChoiceService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;
use Healthy360\Tenancy\TenantContext;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;

/*
|--------------------------------------------------------------------------
| The customer's own meals, as generation sees it
|--------------------------------------------------------------------------
|
| Customers choose every meal of every delivery day; generation turns a day's
| choices into the order's meal lines. Five properties carry the file:
|
|  1. **A day with no choices and nothing to repeat** still generates — the
|     plan-day line alone — and no choice row is invented.
|  2. **Chosen meals become the food**: zero-priced meal lines, and stock moves
|     when the kitchen confirms. A dish chosen for two sittings is one line of
|     two, because `order_lines` is unique per article.
|  3. **A day nobody chose for repeats the customer's own choices**, preferring
|     the same weekday, as source `repeated`.
|  4. **Under row-level security**, as the scheduler runs it.
|  5. **An unsafe choice is substituted** from the kitchen's published meals.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = SubscriptionWorld::build('chosen@kitchen.test', perDayMinor: 2000, days: 20);
    $this->subscriptions = app(SubscriptionService::class);
    $this->generation = app(GenerationService::class);

    /**
     * A published, orderable dish of this kitchen — what a customer may
     * choose.
     *
     * Offered on the world's channel because a composed order's meal line is
     * probed exactly as a basket's is: an unoffered article is refused even
     * when the price is overridden. Priced as well, because a *substitution*
     * candidate is probed with no override at all, and an unpriced dish is not
     * orderable — a dish a real kitchen sells has both.
     */
    $this->dish = fn (string $nameEn): CatalogueItem => SubscriptionWorld::dish($this->world, $nameEn);

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
     * Choose a day's meals for the subscription, as `PUT …/choices` or the
     * purchase would write them.
     *
     * @param  list<array{0: string, 1: CatalogueItem}>  $meals  slot, dish
     */
    $this->choose = function (Subscription $subscription, CarbonImmutable $date, array $meals): void {
        app(MealChoiceService::class)->writeDay($subscription, $date, array_map(
            static fn (array $meal): array => ['slot' => $meal[0], 'catalogue_item_id' => (string) $meal[1]->getKey()],
            $meals,
        ));
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
| 1. Nothing chosen, nothing to repeat
*/

it('generates the plan-day line alone when nobody chose and there is nothing to repeat', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect($this->generation->tick()['generated'])->toBe(1);

    $lines = Order::query()->sole()->lines()->get();

    expect($lines)->toHaveCount(1)
        ->and($lines->first()->catalogue_item_id)->toBe((string) $this->world->plan->getKey())
        ->and($lines->first()->price_source)->toBe(PriceOverride::SUBSCRIPTION_CAPTURE)
        ->and($lines->first()->unit_price_minor)->toBe(2000);

    // Never invent a dish.
    expect(SubscriptionMealChoice::query()->where('subscription_id', $subscription->getKey())->count())->toBe(0);
});

/*
| 2. The customer's choices are the food
*/

it('fills the day from the meals chosen at purchase, prices the food at zero, and records who chose it', function (): void {
    $chicken = ($this->dish)('Grilled chicken');
    $soup = ($this->dish)('Red lentil soup');

    $first = SubscriptionWorld::firstDay($this->world);

    $subscription = $this->subscriptions->create(SubscriptionWorld::request(
        $this->world,
        days: SubscriptionWorld::everyDay($first, 20, (string) $chicken->getKey(), (string) $soup->getKey()),
    ));

    expect(SubscriptionMealChoice::query()->where('subscription_id', $subscription->getKey())->count())->toBe(40);

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect($this->generation->tick()['generated'])->toBe(1);

    $choices = SubscriptionMealChoice::query()
        ->where('subscription_id', $subscription->getKey())
        ->whereDate('delivery_date', $first->toDateString())
        ->get();

    expect($choices)->toHaveCount(2)
        ->and($choices->pluck('source')->unique()->all())->toBe([MealChoiceSource::Customer])
        ->and($choices->firstWhere('slot', 'lunch')->catalogue_item_id)->toBe((string) $chicken->getKey())
        ->and($choices->firstWhere('slot', 'dinner')->catalogue_item_id)->toBe((string) $soup->getKey())
        ->and($choices->every(fn ($choice): bool => $choice->safety_checked_at !== null))->toBeTrue();

    $order = Order::query()->sole();
    $mealLines = $order->lines()->get()->whereNotIn('catalogue_item_id', [(string) $this->world->plan->getKey()]);

    expect($mealLines)->toHaveCount(2)
        ->and($mealLines->pluck('unit_price_minor')->unique()->all())->toBe([0])
        ->and($mealLines->pluck('price_source')->unique()->all())->toBe([PriceOverride::SUBSCRIPTION_INCLUDED])
        ->and($order->subtotal_minor)->toBe(2000);

    $this->actingAs($this->world->customer->account->user);

    $served = $this->getJson('/api/v1/me/subscriptions/'.$subscription->getKey().'/deliveries', firstPartyHeaders())
        ->assertOk()
        ->json('data.0.meals');

    expect(array_column($served, 'source'))->toBe(['customer', 'customer'])
        ->and(array_column($served, 'name'))->toBe(['Red lentil soup', 'Grilled chicken']);
});

it('puts a dish chosen for two sittings on the order as one line of two', function (): void {
    $chicken = ($this->dish)('Grilled chicken');

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));
    ($this->choose)($subscription, $subscription->next_generation_date, [['lunch', $chicken], ['dinner', $chicken]]);

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    // `order_lines_one_row_per_article` would refuse two rows for one dish.
    expect($this->generation->tick())->toMatchArray(['generated' => 1, 'skipped' => 0]);

    $line = Order::query()->sole()->lines()->get()->firstWhere('catalogue_item_id', (string) $chicken->getKey());

    expect((float) $line->quantity)->toBe(2.0)
        ->and($line->line_total_minor)->toBe(0);
});

/*
| 3. A day nobody chose for repeats the customer's own choices
*/

it('repeats the latest choices for the same weekday onto a day nobody chose for', function (): void {
    $chicken = ($this->dish)('Grilled chicken');
    $soup = ($this->dish)('Red lentil soup');
    $salad = ($this->dish)('Garden salad');

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));
    $first = $subscription->next_generation_date->startOfDay();

    // The first day (this weekday) and the day after (later, another weekday)
    // are chosen; a week on — a day a skip pushed the balance onto — is not.
    ($this->choose)($subscription, $first, [['lunch', $chicken], ['dinner', $soup]]);
    ($this->choose)($subscription, $first->addDay(), [['lunch', $salad], ['dinner', $salad]]);

    $target = $first->addDays(7);
    $subscription->next_generation_date = $target;
    $subscription->save();

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDays(8));

    expect($this->generation->tick()['generated'])->toBe(1);

    $repeated = SubscriptionMealChoice::query()
        ->where('subscription_id', $subscription->getKey())
        ->whereDate('delivery_date', $target->toDateString())
        ->get();

    expect($repeated)->toHaveCount(2)
        ->and($repeated->pluck('source')->unique()->all())->toBe([MealChoiceSource::Repeated])
        ->and($repeated->firstWhere('slot', 'lunch')->catalogue_item_id)->toBe((string) $chicken->getKey())
        ->and($repeated->firstWhere('slot', 'dinner')->catalogue_item_id)->toBe((string) $soup->getKey());

    expect(Order::query()->sole()->lines()->pluck('catalogue_item_id')->all())
        ->toContain((string) $chicken->getKey(), (string) $soup->getKey());
});

it('deducts real ingredients when the kitchen confirms an order the customer chose', function (): void {
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

    ($this->choose)($subscription, $subscription->next_generation_date, [['lunch', $dish], ['dinner', $dish]]);

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

    // 250 g ÷ 5 pieces = 50 g = 0.05 kg, twice: the dish fills both sittings.
    expect((string) StockLevel::withoutTenancy()->where('stock_item_id', $stockItem->getKey())->value('quantity'))
        ->toBe('99.9000');
});

/*
| 4. Row-level security
*/

it('puts the customer’s dish on the kitchen’s order under row-level security, as the scheduler runs it', function (): void {
    // Every other test here connects as the schema owner and so bypasses RLS.
    // The scheduler does not: it runs as the runtime role with no tenant
    // context, and before generation ran as the kitchen it read no row for the
    // customer and skipped the day `customer_record_unreadable`. This customer
    // has never placed an ordinary order, so only the subscriber arm admits them.
    $customersChoice = ($this->dish)('Customer lunch');

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));
    $date = $subscription->next_generation_date;

    ($this->choose)($subscription, $date, [['lunch', $customersChoice], ['dinner', ($this->dish)('Customer dinner')]]);

    // And as a plan built in the admin: listed on no channel, since the plan
    // editor has no writer for channel rows.
    ChannelCatalogueItem::withoutTenancy()
        ->where('catalogue_item_id', $this->world->plan->getKey())
        ->delete();

    app(TenantContext::class)->clear();
    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    RuntimeRole::context();
    $tally = RuntimeRole::run(fn (): array => $this->generation->tick());

    expect($tally['generated'])->toBe(1)
        ->and($tally['skipped'])->toBe(0)
        ->and(Order::query()->sole()->lines()->pluck('catalogue_item_id')->all())
        ->toContain((string) $customersChoice->getKey());
});

/*
| 5. An unsafe choice goes through the substitution path
*/

it('substitutes an unsafe choice with a safe meal the kitchen publishes', function (): void {
    $allergen = Allergen::factory()->create(['code' => 'peanuts']);
    SubscriptionWorld::declareAllergen($this->world, $allergen->code);

    // `$unsafe` is unassessed: the customer declared an allergy and nobody has
    // ever assessed the dish. `$safe` is assessed and sorts first by name.
    $unsafe = ($this->dish)('Unassessed lunch');
    $safe = ($this->assessed)(($this->dish)('Aa assessed lunch'));
    $dinner = ($this->assessed)(($this->dish)('Assessed dinner'));

    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));
    ($this->choose)($subscription, $subscription->next_generation_date, [['lunch', $unsafe], ['dinner', $dinner]]);

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect($this->generation->tick()['generated'])->toBe(1);

    $choice = SubscriptionMealChoice::query()
        ->where('subscription_id', $subscription->getKey())
        ->where('slot', 'lunch')
        ->sole();

    expect($choice->source)->toBe(MealChoiceSource::Substituted)
        ->and($choice->replaced_catalogue_item_id)->toBe((string) $unsafe->getKey())
        ->and($choice->catalogue_item_id)->toBe((string) $safe->getKey());
});
