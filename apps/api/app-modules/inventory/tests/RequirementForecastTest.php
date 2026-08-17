<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\RequirementForecast;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| The requirement forecast — what to buy, and what nobody could work out
|--------------------------------------------------------------------------
|
| One fixture world carries the whole file, and it is built so that the three
| demand populations land on **three different shelves**. That is the only way a
| test can say "the order contributed this and the subscription day contributed
| that" without asserting on a single sum that three bugs could cancel each other
| out inside:
|
|   * onions  ← a real order line
|   * carrots ← an explicit meal choice on a claimed subscription day
|   * flour   ← a plan-menu slot on a projected day nobody has chosen for
|
| The window is a fixed Monday-to-Sunday so the weekday arithmetic behind the
| projection is stated rather than inherited from the day the suite happens to
| run. The subscription delivers on Wednesdays only, and Tuesday carries a
| claimed delivery row, so exactly one day of the window projects and exactly one
| is claimed.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    // A Monday. Every date below is stated as an offset from it, so the
    // projection's weekday rule is visible in the test rather than in the clock.
    $this->monday = CarbonImmutable::parse('2026-09-07')->startOfDay();
    $this->tuesday = $this->monday->addDay();
    $this->wednesday = $this->monday->addDays(2);
    $this->thursday = $this->monday->addDays(3);
    $this->sunday = $this->monday->addDays(6);

    CarbonImmutable::setTestNow($this->monday->addHours(9));

    $this->world = SubscriptionWorld::build('forecast@kitchen.test', days: 20);
    $this->organisationId = (string) $this->world->organisation->getKey();
    $this->branchId = (string) $this->world->branch->getKey();

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->g = MeasurementUnit::query()->where('code', 'g')->sole();
    $this->litre = MeasurementUnit::query()->where('code', 'l')->sole();

    $this->forecast = app(RequirementForecast::class);

    /**
     * An ingredient with exactly one shelf, in the unit given.
     *
     * Derivation (INV2.0) hands a declared ingredient a shelf the moment it
     * exists; that row is dropped and a named one created in its place so the
     * assertions can name the code they expect.
     *
     * @return array{0: Ingredient, 1: StockItem}
     */
    $this->shelf = function (string $code, MeasurementUnit $unit): array {
        $ingredient = Ingredient::factory()->create([
            'organisation_id' => $this->organisationId,
            'default_unit_id' => (string) $unit->getKey(),
        ]);

        StockItem::withoutTenancy()->where('ingredient_id', (string) $ingredient->getKey())->delete();

        $stockItem = StockItem::withoutTenancy()->create([
            'organisation_id' => $this->organisationId,
            'code' => $code,
            'name_en' => 'Shelf '.$code,
            'unit_code' => $unit->code,
            'unit_id' => (string) $unit->getKey(),
            'ingredient_id' => (string) $ingredient->getKey(),
        ]);

        return [$ingredient, $stockItem];
    };

    /** A published dish whose recipe takes `$quantity` of `$ingredient` per sold unit. */
    $this->meal = function (
        string $nameEn,
        Ingredient $ingredient,
        string $quantity,
        MeasurementUnit $unit,
        int $yieldPieceCount = 1,
        string $wastePercent = '0.00',
    ): CatalogueItem {
        $recipe = Recipe::factory()->create(['organisation_id' => $this->organisationId]);

        $version = RecipeVersion::factory()->published()->create([
            'recipe_id' => $recipe->getKey(),
            'organisation_id' => $this->organisationId,
            'yield_piece_count' => $yieldPieceCount,
            'waste_coefficient_percent' => $wastePercent,
        ]);

        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $this->organisationId,
            'line_number' => 1,
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => $quantity,
            'unit_id' => (string) $unit->getKey(),
        ]);

        return CatalogueItem::factory()->meal()->create([
            'catalogue_id' => $this->world->tenant->catalogue->getKey(),
            'organisation_id' => $this->organisationId,
            'recipe_id' => $recipe->getKey(),
            'status' => CatalogueItemStatus::Published,
            'name_en' => $nameEn,
        ]);
    };

    /** What the branch holds of a shelf, and optionally the level it restocks to. */
    $this->level = function (StockItem $stockItem, string $quantity, ?string $parLevel = null, ?string $threshold = null): StockLevel {
        return StockLevel::withoutTenancy()->create([
            'organisation_id' => $this->organisationId,
            'branch_id' => $this->branchId,
            'stock_item_id' => (string) $stockItem->getKey(),
            'quantity' => $quantity,
            'reorder_threshold' => $threshold,
            'par_level' => $parLevel,
        ]);
    };

    /**
     * A real order for a date, with the lines given as `[CatalogueItem, quantity]`.
     *
     * @param  list<array{0: CatalogueItem, 1: string}>  $lines
     */
    $this->order = function (CarbonImmutable $date, array $lines, OrderStatus $status = OrderStatus::Placed): Order {
        $order = Order::factory()->create([
            'organisation_id' => $this->organisationId,
            'customer_account_id' => $this->world->customer->account->getKey(),
            'sales_channel_id' => $this->world->channel->getKey(),
            'branch_id' => $this->branchId,
            'requested_delivery_date' => $date->toDateString(),
            'status' => $status,
            'cancelled_at' => $status === OrderStatus::Cancelled ? CarbonImmutable::now() : null,
            'cancellation_reason' => $status === OrderStatus::Cancelled ? CancellationReason::CustomerRequested : null,
        ]);

        foreach ($lines as [$item, $quantity]) {
            OrderLine::factory()->create([
                'order_id' => $order->getKey(),
                'catalogue_item_id' => $item->getKey(),
                'quantity' => $quantity,
            ]);
        }

        return $order;
    };

    /** A subscription of this world's plan that delivers on the weekdays given. */
    $this->subscription = function (array $weekdays = [3]): Subscription {
        return Subscription::factory()->create([
            'organisation_id' => $this->organisationId,
            'customer_account_id' => $this->world->customer->account->getKey(),
            'sales_channel_id' => $this->world->channel->getKey(),
            'branch_id' => $this->branchId,
            'catalogue_item_id' => $this->world->plan->getKey(),
            'catalogue_item_variant_id' => $this->world->configuration->getKey(),
            'plan_duration_id' => $this->world->duration->getKey(),
            'customer_address_id' => $this->world->customer->address->getKey(),
            'currency_code' => 'USD',
            'weekdays' => $weekdays,
        ]);
    };

    /** A day the generator has claimed and not yet ordered. */
    $this->claimedDay = function (Subscription $subscription, CarbonImmutable $date): SubscriptionDelivery {
        return SubscriptionDelivery::query()->create([
            'subscription_id' => $subscription->getKey(),
            'organisation_id' => $this->organisationId,
            'branch_id' => $this->branchId,
            'delivery_date' => $date->toDateString(),
            'status' => SubscriptionDeliveryStatus::Scheduled,
            'consumed' => false,
        ]);
    };

    /** What somebody has said fills one slot of one subscription day. */
    $this->choice = function (Subscription $subscription, CarbonImmutable $date, CatalogueItem $meal, string $slot = 'lunch', int $sequence = 1): SubscriptionMealChoice {
        return SubscriptionMealChoice::query()->create([
            'subscription_id' => $subscription->getKey(),
            'organisation_id' => $this->organisationId,
            'delivery_date' => $date->toDateString(),
            'slot' => $slot,
            'sequence' => $sequence,
            'catalogue_item_id' => $meal->getKey(),
            'source' => MealChoiceSource::Customer,
        ]);
    };

    /**
     * Publish a menu on the world's plan, anchored so `$anchor` is cycle day 1.
     *
     * @param  list<array{0: int, 1: string, 2: CatalogueItem}>  $entries  [cycleDay, slot, dish]
     */
    $this->publishMenu = function (array $entries, CarbonImmutable $anchor, int $cycleDays = 7): void {
        foreach ($entries as $index => [$cycleDay, $slot, $dish]) {
            PlanMenuEntry::factory()->create([
                'organisation_id' => $this->organisationId,
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

    /** The forecast for the whole fixture week, at this world's branch. */
    $this->week = fn (): object => $this->forecast->forOrganisation(
        $this->organisationId,
        $this->monday,
        $this->sunday,
        $this->branchId,
    );

    /** One requirement row by shelf code, or null. */
    $this->row = function (object $result, string $code): ?array {
        foreach ($result->requirements as $row) {
            if ($row['code'] === $code) {
                return $row;
            }
        }

        return null;
    };
});

afterEach(function (): void {
    CarbonImmutable::setTestNow();
    app(TenantContext::class)->clear();
});

/*
| 1. Three populations, three shelves, one window
*/

it('counts a real order, an explicit choice and a plan-menu day as three separate demands', function (): void {
    [$onion, $onionShelf] = ($this->shelf)('sku-onion', $this->kg);
    [$carrot, $carrotShelf] = ($this->shelf)('sku-carrot', $this->kg);
    [$flour, $flourShelf] = ($this->shelf)('sku-flour', $this->kg);

    $roast = ($this->meal)('Roast', $onion, '2', $this->kg);
    $stew = ($this->meal)('Stew', $carrot, '3', $this->kg);
    $pie = ($this->meal)('Pie', $flour, '5', $this->kg);

    ($this->level)($onionShelf, '100.0000');
    ($this->level)($carrotShelf, '100.0000');
    ($this->level)($flourShelf, '100.0000');

    // Population 1: four roasts on Thursday, two kilos of onion each.
    ($this->order)($this->thursday, [[$roast, '4.0000']]);

    $subscription = ($this->subscription)(weekdays: [3]);

    // Population 2: Tuesday is claimed and somebody chose the stew for it.
    ($this->claimedDay)($subscription, $this->tuesday);
    ($this->choice)($subscription, $this->tuesday, $stew);

    // Population 3: Wednesday is projected, nobody has chosen, and the menu
    // says pie. Anchored on Wednesday so that is cycle day 1; Tuesday falls on
    // day 7, which the menu leaves empty, so the claimed day's own slot stays
    // population 2's.
    ($this->publishMenu)([[1, 'lunch', $pie]], anchor: $this->wednesday);

    $result = ($this->week)();

    expect($result->notComputableDays)->toBe(0)
        ->and($result->requirements)->toHaveCount(3);

    // 4 roasts × 2 kg; 1 stew × 3 kg; 1 pie × 5 kg. Three populations, three
    // shelves, and none of them borrowed a gram from another.
    expect(($this->row)($result, 'sku-onion')['required'])->toBe('8.000000')
        ->and(($this->row)($result, 'sku-carrot')['required'])->toBe('3.000000')
        ->and(($this->row)($result, 'sku-flour')['required'])->toBe('5.000000');

    // And the shelf answers for the branch that was asked about.
    expect(($this->row)($result, 'sku-onion')['available'])->toBe('100.0000')
        ->and(($this->row)($result, 'sku-onion')['short'])->toBe('0.0000')
        ->and(($this->row)($result, 'sku-onion')['unit_code'])->toBe('kg')
        ->and(($this->row)($result, 'sku-onion')['stock_item_id'])->toBe((string) $onionShelf->getKey())
        ->and(($this->row)($result, 'sku-onion')['ingredient_id'])->toBe((string) $onion->getKey());
});

it('never counts a cancelled order', function (): void {
    [$onion, $onionShelf] = ($this->shelf)('sku-onion', $this->kg);
    $roast = ($this->meal)('Roast', $onion, '2', $this->kg);
    ($this->level)($onionShelf, '100.0000');

    ($this->order)($this->thursday, [[$roast, '4.0000']], OrderStatus::Cancelled);

    expect(($this->week)()->requirements)->toBe([]);
});

it('counts a fulfilled order, because a fulfilled order still ate its ingredients', function (): void {
    [$onion, $onionShelf] = ($this->shelf)('sku-onion', $this->kg);
    $roast = ($this->meal)('Roast', $onion, '2', $this->kg);
    ($this->level)($onionShelf, '100.0000');

    ($this->order)($this->thursday, [[$roast, '1.0000']], OrderStatus::Fulfilled);

    expect(($this->row)(($this->week)(), 'sku-onion')['required'])->toBe('2.000000');
});

/*
| 2. Aggregate first, explode once
*/

it('sums a meal across orders and explodes it once, landing on the figure computed by hand', function (): void {
    // The dish takes 100 g + 150 g of flour, yields four pieces and wastes
    // 12.5%. Two orders on two days want three and five of it.
    //
    //   grams group : 250.000000000000 → rounded 250.000000 → 0.250000 kg
    //   ÷ 4 pieces  = 0.062500000000 per sold unit
    //   × 1.125     = 0.070312500000
    //   × 8 sold    = 0.562500000000
    //   rounded half away from zero, once → 0.562500
    //
    // Exploding three and five separately would round twice and could not land
    // on this figure; that is the whole reason the quantities are summed first.
    [$flour, $flourShelf] = ($this->shelf)('sku-flour', $this->kg);

    $recipe = Recipe::factory()->create(['organisation_id' => $this->organisationId]);
    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->organisationId,
        'yield_piece_count' => 4,
        'waste_coefficient_percent' => '12.50',
    ]);

    foreach (['100', '150'] as $index => $quantity) {
        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $this->organisationId,
            'line_number' => $index + 1,
            'ingredient_id' => (string) $flour->getKey(),
            'quantity' => $quantity,
            'unit_id' => (string) $this->g->getKey(),
        ]);
    }

    $pie = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->world->tenant->catalogue->getKey(),
        'organisation_id' => $this->organisationId,
        'recipe_id' => $recipe->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);

    ($this->level)($flourShelf, '100.0000');
    ($this->order)($this->tuesday, [[$pie, '3.0000']]);
    ($this->order)($this->thursday, [[$pie, '5.0000']]);

    $result = ($this->week)();

    expect($result->requirements)->toHaveCount(1)
        ->and($result->requirements[0]['required'])->toBe('0.562500');
});

/*
| 3. Holes, and the fact that they are never zeroes
*/

it('records a plan with no menu as not computable rather than as nothing to buy', function (): void {
    $subscription = ($this->subscription)(weekdays: [3]);
    ($this->claimedDay)($subscription, $this->tuesday);

    $result = ($this->week)();

    // Nothing to buy — and, crucially, no row saying so. Two days carry the
    // hole: the claimed Tuesday and the projected Wednesday.
    expect($result->requirements)->toBe([])
        ->and($result->notComputableDays)->toBe(2)
        ->and($result->reasons)->toBe(['plan_has_no_menu' => 2]);
});

it('leaves a day alone when the plan has no menu but somebody chose for it', function (): void {
    [$carrot, $carrotShelf] = ($this->shelf)('sku-carrot', $this->kg);
    $stew = ($this->meal)('Stew', $carrot, '3', $this->kg);
    ($this->level)($carrotShelf, '100.0000');

    $subscription = ($this->subscription)(weekdays: [1]);
    ($this->claimedDay)($subscription, $this->tuesday);
    ($this->choice)($subscription, $this->tuesday, $stew);

    $result = ($this->week)();

    // Monday projects (weekday 1) and has neither a menu nor a choice, so it is
    // the one hole. Tuesday is answered by the choice and raises nothing.
    expect(($this->row)($result, 'sku-carrot')['required'])->toBe('3.000000')
        ->and($result->reasons)->toBe(['plan_has_no_menu' => 1])
        ->and($result->notComputableDays)->toBe(1);
});

it('treats a withdrawn dish on the menu as a hole rather than as demand', function (): void {
    [$flour, $flourShelf] = ($this->shelf)('sku-flour', $this->kg);
    $pie = ($this->meal)('Pie', $flour, '5', $this->kg);
    ($this->level)($flourShelf, '100.0000');

    ($this->subscription)(weekdays: [3]);
    ($this->publishMenu)([[1, 'lunch', $pie]], anchor: $this->wednesday);

    // The kitchen takes the dish off sale after writing the menu. Generation
    // would leave the slot empty; the forecast must not buy for it, and must
    // not pretend the day is fully answered either.
    $pie->status = CatalogueItemStatus::Retired;
    $pie->save();

    $result = ($this->week)();

    expect($result->requirements)->toBe([])
        ->and($result->reasons)->toBe(['menu_dish_withdrawn' => 1])
        ->and($result->notComputableDays)->toBe(1);
});

it('renames the explosion’s missing version into the forecast’s own vocabulary', function (): void {
    // A meal with no published recipe version at all: `CatalogueItem::factory()`
    // leaves `recipe_id` null, which is exactly a dish nobody has written down.
    $dish = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->world->tenant->catalogue->getKey(),
        'organisation_id' => $this->organisationId,
        'status' => CatalogueItemStatus::Published,
    ]);

    ($this->order)($this->thursday, [[$dish, '2.0000']]);

    $result = ($this->week)();

    expect($result->requirements)->toBe([])
        ->and($result->reasons)->toBe(['meal_has_no_recipe' => 1])
        ->and($result->notComputableDays)->toBe(1);
});

it('reports a count-versus-mass recipe line as an unsupported conversion', function (): void {
    // Flour on the shelf in kilograms, measured in the recipe in litres. No
    // density exists, so the ingredient is abandoned — one hole, no quantity.
    [$flour, $flourShelf] = ($this->shelf)('sku-flour', $this->kg);
    $soup = ($this->meal)('Soup', $flour, '1', $this->litre);
    ($this->level)($flourShelf, '100.0000');

    ($this->order)($this->thursday, [[$soup, '1.0000']]);

    $result = ($this->week)();

    expect($result->requirements)->toBe([])
        ->and($result->reasons)->toBe(['unit_conversion_unsupported' => 1]);
});

it('counts one day per reason however many ingredients raised it', function (): void {
    // Two ingredients of one dish, neither with a shelf. Two failures, one
    // Thursday — the number a buyer wants is how much of the window is
    // guesswork, not how elaborate the recipe was.
    $first = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $this->kg->getKey(),
    ]);
    $second = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $this->kg->getKey(),
    ]);

    StockItem::withoutTenancy()->whereIn('ingredient_id', [$first->getKey(), $second->getKey()])->delete();

    $recipe = Recipe::factory()->create(['organisation_id' => $this->organisationId]);
    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->organisationId,
        'yield_piece_count' => 1,
        'waste_coefficient_percent' => '0.00',
    ]);

    foreach ([$first, $second] as $index => $ingredient) {
        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $this->organisationId,
            'line_number' => $index + 1,
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => '1',
            'unit_id' => (string) $this->kg->getKey(),
        ]);
    }

    $dish = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->world->tenant->catalogue->getKey(),
        'organisation_id' => $this->organisationId,
        'recipe_id' => $recipe->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);

    ($this->order)($this->thursday, [[$dish, '1.0000']]);

    $result = ($this->week)();

    expect($result->reasons)->toBe(['no_stock_item' => 1])
        ->and($result->notComputableDays)->toBe(1);
});

/*
| 4. The shelf: precision, par levels, and the branch
*/

it('produces no phantom shortfall when the requirement equals the shelf to four places', function (): void {
    // The requirement computes to six places and the level stores four. A
    // comparison at six would call 1.0000005 short of 1.0000 and send somebody
    // out for a fifty-millionth of a kilo.
    [$flour, $flourShelf] = ($this->shelf)('sku-flour', $this->kg);

    // One kilo across three yielded pieces → 0.333333333333 per sold unit,
    // rounded once to 0.333333. The shelf holds 0.3333 of it, which is the same
    // quantity to every place the column can store.
    $dish = ($this->meal)('Rice', $flour, '1', $this->kg, yieldPieceCount: 3);
    ($this->level)($flourShelf, '0.3333');

    ($this->order)($this->thursday, [[$dish, '1.0000']]);

    $row = ($this->row)(($this->week)(), 'sku-flour');

    expect($row['required'])->toBe('0.333333')
        ->and($row['available'])->toBe('0.3333')
        ->and($row['short'])->toBe('0.0000')
        ->and($row['suggested_buy'])->toBe('0.0000');
});

it('buys up to par, and falls back to the bare shortfall when the par is below what the window needs', function (): void {
    [$onion, $onionShelf] = ($this->shelf)('sku-onion', $this->kg);
    [$carrot, $carrotShelf] = ($this->shelf)('sku-carrot', $this->kg);
    [$flour, $flourShelf] = ($this->shelf)('sku-flour', $this->kg);

    $roast = ($this->meal)('Roast', $onion, '5', $this->kg);
    $stew = ($this->meal)('Stew', $carrot, '5', $this->kg);
    $pie = ($this->meal)('Pie', $flour, '5', $this->kg);

    // Par set well above the window: buy up to it after the week is cooked.
    ($this->level)($onionShelf, '10.0000', parLevel: '20.0000');
    // Par written below the reorder threshold and below the window's own
    // demand — the state H12 warns about. It must never *reduce* the buy.
    ($this->level)($carrotShelf, '1.0000', parLevel: '2.0000', threshold: '8.0000');
    // No par at all: the bare shortfall.
    ($this->level)($flourShelf, '1.0000');

    ($this->order)($this->thursday, [[$roast, '1.0000'], [$stew, '1.0000'], [$pie, '1.0000']]);

    $result = ($this->week)();

    // Onions: need 5, have 10, par 20 → 20 − (10 − 5) = 15, and no shortfall.
    expect(($this->row)($result, 'sku-onion')['short'])->toBe('0.0000')
        ->and(($this->row)($result, 'sku-onion')['suggested_buy'])->toBe('15.0000');

    // Carrots: need 5, have 1 → short 4. Par 2 gives 2 − (1 − 5) = 6… which is
    // positive, so buy-up-to still wins and it is larger than the shortfall.
    expect(($this->row)($result, 'sku-carrot')['short'])->toBe('4.0000')
        ->and(($this->row)($result, 'sku-carrot')['suggested_buy'])->toBe('6.0000');

    // Flour: no par, so the shortfall stands alone.
    expect(($this->row)($result, 'sku-flour')['short'])->toBe('4.0000')
        ->and(($this->row)($result, 'sku-flour')['suggested_buy'])->toBe('4.0000');
});

it('reads availability from the branch it was asked about and from no other', function (): void {
    [$flour, $flourShelf] = ($this->shelf)('sku-flour', $this->kg);
    $pie = ($this->meal)('Pie', $flour, '5', $this->kg);

    $other = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisationId,
        'country_code' => $this->world->organisation->country_code,
    ]);

    StockLevel::withoutTenancy()->create([
        'organisation_id' => $this->organisationId,
        'branch_id' => (string) $other->getKey(),
        'stock_item_id' => (string) $flourShelf->getKey(),
        'quantity' => '500.0000',
    ]);

    ($this->order)($this->thursday, [[$pie, '1.0000']]);

    // Five hundred kilos next door, and none here: a shelf with no level row at
    // this branch holds nothing, which is a zero rather than an unknown.
    $row = ($this->row)(($this->week)(), 'sku-flour');

    expect($row['available'])->toBe('0.0000')
        ->and($row['short'])->toBe('5.0000');
});

/*
| 5. Isolation and tenancy
*/

it('never reads another kitchen’s demand or another kitchen’s shelves', function (): void {
    [$flour, $flourShelf] = ($this->shelf)('sku-flour', $this->kg);
    $pie = ($this->meal)('Pie', $flour, '5', $this->kg);
    ($this->level)($flourShelf, '100.0000');
    ($this->order)($this->thursday, [[$pie, '1.0000']]);

    $stranger = SubscriptionWorld::build('stranger@kitchen.test', days: 20);

    $result = $this->forecast->forOrganisation(
        (string) $stranger->organisation->getKey(),
        $this->monday,
        $this->sunday,
        (string) $stranger->branch->getKey(),
    );

    expect($result->requirements)->toBe([])
        ->and($result->notComputableDays)->toBe(0);
});

it('answers with no ambient tenant at all, because a job has none', function (): void {
    [$flour, $flourShelf] = ($this->shelf)('sku-flour', $this->kg);
    $pie = ($this->meal)('Pie', $flour, '5', $this->kg);
    ($this->level)($flourShelf, '2.0000');
    ($this->order)($this->thursday, [[$pie, '1.0000']]);

    app(TenantContext::class)->clear();

    $row = ($this->row)(($this->week)(), 'sku-flour');

    expect($row['required'])->toBe('5.000000')
        ->and($row['short'])->toBe('3.0000');
});

/*
| 6. Resold products take their own quantity off their own shelf
*/

it('takes a resold product off the shelf its ingredient names, and says so when it names none', function (): void {
    [$water, $waterShelf] = ($this->shelf)('sku-water', $this->litre);

    $bottled = CatalogueItem::factory()->create([
        'catalogue_id' => $this->world->tenant->catalogue->getKey(),
        'organisation_id' => $this->organisationId,
        'status' => CatalogueItemStatus::Published,
        'ingredient_id' => (string) $water->getKey(),
    ]);

    $unlinked = CatalogueItem::factory()->create([
        'catalogue_id' => $this->world->tenant->catalogue->getKey(),
        'organisation_id' => $this->organisationId,
        'status' => CatalogueItemStatus::Published,
        'ingredient_id' => null,
    ]);

    ($this->level)($waterShelf, '1.0000');
    ($this->order)($this->thursday, [[$bottled, '6.0000'], [$unlinked, '2.0000']]);

    $result = ($this->week)();

    // Six sold, six gone — one for one, no recipe involved.
    expect(($this->row)($result, 'sku-water')['required'])->toBe('6.000000')
        ->and(($this->row)($result, 'sku-water')['short'])->toBe('5.0000')
        ->and($result->reasons)->toBe(['no_ingredient_link' => 1]);
});
