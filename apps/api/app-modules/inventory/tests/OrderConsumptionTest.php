<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Database\Factories\SalesChannelFactory;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Inventory\Models\OrderLineEstimatedCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Models\StockReservation;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Inventory\Services\OrderConsumptionService;
use Healthy360\Inventory\Services\ReservationService;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Collection;

/*
|--------------------------------------------------------------------------
| OrderConsumptionService — auto-deduction on confirm, with COGS (INV1.2)
|--------------------------------------------------------------------------
|
| The correctness crux of the feature: a confirmed order takes the right
| quantity of the right ingredient off the right branch's shelf, valued at the
| ingredient's moving-average cost, and a cancelled order puts it all back. The
| arithmetic is money and stock under concurrency, so it is tested end to end —
| the recipe explosion, the honest fallbacks that record an exception instead of
| guessing, and the idempotent reversal.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('consume@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'country_code' => $this->organisation->country_code,
    ]);

    // The confirm path runs with the seller's tenant context resolved, exactly
    // as the controller sets it; the inventory level read-modify-write needs it.
    app(TenantContext::class)->setOrganisation((string) $this->tenant->user->getKey(), (string) $this->organisation->getKey());

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->g = MeasurementUnit::query()->where('code', 'g')->sole();
    $this->litre = MeasurementUnit::query()->where('code', 'l')->sole();
    $this->piece = MeasurementUnit::query()->where('code', 'piece')->sole();

    $this->lifecycle = app(OrderLifecycle::class);
    $this->consumption = app(OrderStockConsumption::class);
    $this->inventory = app(InventoryService::class);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * An ingredient with a branch stock item, a starting shelf quantity and a
 * moving-average cost. Returns the stock item.
 *
 * @param  numeric-string  $averageCost
 * @param  numeric-string  $onHand  the moving-average basis quantity, in the ingredient unit
 * @param  numeric-string  $stockQuantity  the branch shelf quantity, in the stock unit
 */
function stockedIngredient(object $test, MeasurementUnit $unit, string $averageCost, string $onHand, string $stockQuantity, ?MeasurementUnit $stockUnit = null): StockItem
{
    $stockUnit ??= $unit;

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $test->organisation->getKey(),
        'default_unit_id' => (string) $unit->getKey(),
    ]);

    $item = StockItem::query()->create([
        'organisation_id' => $test->organisation->getKey(),
        'code' => 'sku-'.fake()->unique()->numberBetween(1, 999999),
        'name_en' => 'Stocked '.fake()->word(),
        'unit_code' => $stockUnit->code,
        'unit_id' => (string) $stockUnit->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    if (bccomp($averageCost, '0', 6) > 0 || bccomp($onHand, '0', 6) !== 0) {
        IngredientStockCost::query()->create([
            'organisation_id' => $test->organisation->getKey(),
            'ingredient_id' => (string) $ingredient->getKey(),
            'unit_id' => (string) $unit->getKey(),
            'quantity_on_hand' => $onHand,
            'moving_average_cost_amount' => $averageCost,
            'last_purchase_cost_amount' => $averageCost,
            'currency_code' => 'USD',
        ]);
    }

    if (bccomp($stockQuantity, '0', 6) > 0) {
        $test->inventory->recordMovement(
            (string) $test->organisation->getKey(),
            (string) $test->branch->getKey(),
            (string) $item->getKey(),
            'receipt',
            $stockQuantity,
        );
    }

    return $item;
}

/**
 * A published meal whose recipe version explodes into the given lines. Each
 * line is `[Ingredient-linked StockItem, quantity, MeasurementUnit]`.
 *
 * @param  list<array{0: StockItem, 1: string, 2: MeasurementUnit}>  $lines
 */
function publishedMeal(object $test, ?int $yieldPieceCount, string $wastePercent, array $lines): CatalogueItem
{
    $recipe = Recipe::factory()->create(['organisation_id' => $test->organisation->getKey()]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $test->organisation->getKey(),
        'yield_piece_count' => $yieldPieceCount,
        'waste_coefficient_percent' => $wastePercent,
    ]);

    $lineNumber = 1;
    foreach ($lines as [$stockItem, $quantity, $unit]) {
        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $test->organisation->getKey(),
            'line_number' => $lineNumber++,
            'ingredient_id' => $stockItem->ingredient_id,
            'quantity' => $quantity,
            'unit_id' => (string) $unit->getKey(),
        ]);
    }

    $catalogue = Catalogue::factory()->create(['organisation_id' => $test->organisation->getKey()]);

    return CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $test->organisation->getKey(),
        'recipe_id' => $recipe->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);
}

/**
 * An order for this kitchen with one line, ready to confirm.
 */
function orderFor(object $test, CatalogueItem $item, string $quantity, bool $withBranch = true): Order
{
    $customer = CustomerAccountFactory::new()->create();
    $channel = SalesChannelFactory::new()->create(['organisation_id' => $test->organisation->getKey()]);

    $order = Order::factory()->create([
        'organisation_id' => $test->organisation->getKey(),
        'customer_account_id' => $customer->getKey(),
        'sales_channel_id' => $channel->getKey(),
        'branch_id' => $withBranch ? $test->branch->getKey() : null,
    ]);

    OrderLine::factory()->create([
        'order_id' => $order->getKey(),
        'catalogue_item_id' => $item->getKey(),
        'quantity' => $quantity,
    ]);

    return $order;
}

function consumeMovements(Order $order): Collection
{
    return StockMovement::withoutTenancy()
        ->where('reference_type', 'order')
        ->where('reference_id', (string) $order->getKey())
        ->where('reason', 'consume')
        ->get();
}

function levelOf(StockItem $item): string
{
    return (string) StockLevel::withoutTenancy()->where('stock_item_id', $item->getKey())->value('quantity');
}

/**
 * Remove the shelf derivation (INV2.0) creates the instant an ingredient is
 * declared, for the two tests that are *about* an ingredient having none.
 *
 * Deleting it is the honest arrangement: the alternative is a test that passes
 * only while some other component happens not to have run, which is how a
 * precondition quietly stops being true.
 */
function dropDerivedStockItem(Ingredient $ingredient): void
{
    StockItem::withoutTenancy()->where('ingredient_id', (string) $ingredient->getKey())->delete();
}

it('explodes a meal recipe — summing duplicate lines, dividing by yield, applying waste, converting units, and scaling by order quantity', function (): void {
    // Flour in kg on the shelf and in the average; two duplicate recipe lines
    // (100 g + 150 g = 250 g); yield 5 pieces; 10% waste; two meals ordered.
    //   250 g ÷ 5 = 50 g per sold unit
    //   × 1.10 waste = 55 g
    //   × 2 meals   = 110 g = 0.11 kg
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');

    $meal = publishedMeal($this, yieldPieceCount: 5, wastePercent: '10.00', lines: [
        [$flour, '100', $this->g],
        [$flour, '150', $this->g],
    ]);

    $order = orderFor($this, $meal, '2');

    $this->lifecycle->confirm($order, 0);

    // The shelf dropped by exactly 0.11 kg.
    expect(levelOf($flour))->toBe('99.8900');

    // One consume movement, valued at the moving average: 0.11 kg × 2.00 = 0.22.
    $movements = consumeMovements($order);
    expect($movements)->toHaveCount(1);

    $movement = $movements->first();
    expect((string) $movement->quantity_delta)->toBe('-0.1100')
        ->and((string) $movement->unit_cost_amount)->toBe('2.000000')
        ->and((string) $movement->cost_amount)->toBe('0.220000')
        ->and($movement->cost_currency_code)->toBe('USD')
        // INV1.5: the consume attributes to the order line and the kind sold.
        ->and($movement->order_line_id)->toBe((string) $order->lines()->sole()->getKey())
        ->and($movement->sold_item_type)->toBe('meal');

    // The basis quantity dropped by the consumed amount; the average is untouched.
    $cost = IngredientStockCost::withoutTenancy()->where('ingredient_id', $flour->ingredient_id)->sole();
    expect((string) $cost->quantity_on_hand)->toBe('99.890000')
        ->and((string) $cost->moving_average_cost_amount)->toBe('2.000000');

    // No exception: the whole line resolved.
    expect(OrderConsumptionException::withoutTenancy()->count())->toBe(0);
});

it('deducts a resold product one shelf unit per unit sold, valued at its own moving average', function (): void {
    // A product counted in pieces: 3 sold → 3 off the shelf, 3 × 1.50 = 4.50.
    $product = stockedIngredient($this, $this->piece, '1.500000', '20', '20');

    $catalogue = Catalogue::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $item = CatalogueItem::factory()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'ingredient_id' => $product->ingredient_id,
        'status' => CatalogueItemStatus::Published,
    ]);

    $order = orderFor($this, $item, '3');
    $this->lifecycle->confirm($order, 0);

    expect(levelOf($product))->toBe('17.0000');

    $movement = consumeMovements($order)->sole();
    expect((string) $movement->quantity_delta)->toBe('-3.0000')
        ->and((string) $movement->cost_amount)->toBe('4.500000')
        ->and($movement->cost_currency_code)->toBe('USD')
        // INV1.5: a resold product line attributes as `product`.
        ->and($movement->order_line_id)->toBe((string) $order->lines()->sole()->getKey())
        ->and($movement->sold_item_type)->toBe('product');

    expect((string) IngredientStockCost::withoutTenancy()->where('ingredient_id', $product->ingredient_id)->sole()->quantity_on_hand)->toBe('17.000000');
});

it('consumes nothing for a subscription-plan line', function (): void {
    $catalogue = Catalogue::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $plan = CatalogueItem::factory()->subscriptionPlan()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);

    $order = orderFor($this, $plan, '1');
    $this->lifecycle->confirm($order, 0);

    // The zero-food plan-day line moves no stock and is not an exception.
    expect(consumeMovements($order)->count())->toBe(0)
        ->and(OrderConsumptionException::withoutTenancy()->count())->toBe(0);
});

it('does not deduct twice when consume runs again for the same order', function (): void {
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);
    $order = orderFor($this, $meal, '1');

    $this->lifecycle->confirm($order, 0);

    // 250 g ÷ 5 = 50 g = 0.05 kg deducted once.
    expect(levelOf($flour))->toBe('99.9500');

    // Re-invoking the port must be a no-op — the idempotency guard the lost-
    // update retry relies on.
    $this->consumption->consume($order->refresh());

    expect(levelOf($flour))->toBe('99.9500')
        ->and(consumeMovements($order)->count())->toBe(1);
});

it('restores exactly what it removed when the order is cancelled, and does so only once', function (): void {
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);
    $order = orderFor($this, $meal, '1');

    $this->lifecycle->confirm($order, 0);
    expect(levelOf($flour))->toBe('99.9500');

    $order = $order->refresh();
    $this->lifecycle->cancel($order, CancellationReason::CustomerRequested, $order->lock_version);

    // The shelf and the basis are back to where they started.
    expect(levelOf($flour))->toBe('100.0000')
        ->and((string) IngredientStockCost::withoutTenancy()->where('ingredient_id', $flour->ingredient_id)->sole()->quantity_on_hand)->toBe('100.000000');

    $reversals = StockMovement::withoutTenancy()
        ->where('reference_type', 'order_reversal')
        ->where('reference_id', (string) $order->getKey())
        ->get();
    expect($reversals)->toHaveCount(1);

    // Restoring again is a no-op — no second reversal, shelf unchanged.
    $this->consumption->restore($order->refresh());
    expect(levelOf($flour))->toBe('100.0000')
        ->and(StockMovement::withoutTenancy()->where('reference_type', 'order_reversal')->where('reference_id', (string) $order->getKey())->count())->toBe(1);
});

it('records an exception rather than guessing when the meal links no published recipe version', function (): void {
    $catalogue = Catalogue::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $meal = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'recipe_id' => null,
        'status' => CatalogueItemStatus::Published,
    ]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order, 0);

    expect(consumeMovements($order)->count())->toBe(0);
    expect(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('no_recipe_version');
});

it('records an exception when the recipe version states no yield piece count', function (): void {
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');
    $meal = publishedMeal($this, yieldPieceCount: null, wastePercent: '0.00', lines: [[$flour, '250', $this->g]]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order, 0);

    expect(levelOf($flour))->toBe('100.0000')
        ->and(consumeMovements($order)->count())->toBe(0)
        ->and(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('no_yield_piece_count');
});

it('records an exception when an ingredient has no stock item at the branch', function (): void {
    // A recipe line for an ingredient nothing stocks. Build the meal by hand so
    // the ingredient has no StockItem.
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'default_unit_id' => (string) $this->kg->getKey(),
    ]);

    // Derivation (INV2.0) gives a declared ingredient a shelf immediately, so
    // the state this test is about has to be arranged rather than assumed:
    // without this the deduction reaches an empty shelf and reports
    // `insufficient_stock`, which is a different refusal with a different fix.
    dropDerivedStockItem($ingredient);

    $recipe = Recipe::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'yield_piece_count' => 5,
        'waste_coefficient_percent' => '0.00',
    ]);
    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'ingredient_id' => $ingredient->getKey(),
        'quantity' => '250',
        'unit_id' => (string) $this->g->getKey(),
    ]);

    $catalogue = Catalogue::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $meal = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'recipe_id' => $recipe->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order, 0);

    expect(consumeMovements($order)->count())->toBe(0)
        ->and(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('no_stock_item');
});

it('records an exception when the recipe line unit cannot convert to the stock unit', function (): void {
    // Flour stocked in kilograms (mass); the recipe measures it in litres
    // (volume). There is no density here, so the deduction is refused, not
    // invented.
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '1', $this->litre]]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order, 0);

    expect(levelOf($flour))->toBe('100.0000')
        ->and(consumeMovements($order)->count())->toBe(0)
        ->and(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('unit_conversion_unsupported');
});

it('deducts the stock but records an exception when no moving-average cost exists to value COGS', function (): void {
    // Stock on the shelf, but no IngredientStockCost row: the shelf still moves,
    // the movement carries no cost, and the gap is surfaced rather than priced
    // at zero.
    $flour = stockedIngredient($this, $this->kg, '0', '0', '100');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order, 0);

    expect(levelOf($flour))->toBe('99.9500');

    $movement = consumeMovements($order)->sole();
    expect($movement->cost_amount)->toBeNull()
        ->and($movement->cost_currency_code)->toBeNull();

    expect(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('no_ingredient_cost');
});

it('records an exception instead of hard-failing when there is not enough stock', function (): void {
    // Only 0.01 kg on the shelf, but the meal needs 0.05 kg. The confirm must
    // not fail — a kitchen has committed to cook — so the shortfall is recorded.
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '0.01');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order->refresh(), 0);

    expect($order->refresh()->status->value)->toBe('confirmed')
        ->and(levelOf($flour))->toBe('0.0100')
        ->and(consumeMovements($order)->count())->toBe(0)
        ->and(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('insufficient_stock');
});

it('freezes what a line was expected to cost, and does not move it afterwards', function (): void {
    // Two dollars a kilo typed on the ingredient, 0.05 kg per portion: the line
    // was expected to cost ten cents.
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');

    Ingredient::withoutTenancy()->whereKey($flour->ingredient_id)->update([
        'purchase_price_amount' => '2.000000',
        'purchase_price_currency' => 'USD',
        'purchase_unit_id' => (string) $this->kg->getKey(),
    ]);

    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);
    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order->refresh(), 0);

    $estimate = OrderLineEstimatedCost::withoutTenancy()->sole();

    expect((string) $estimate->estimated_cost_amount)->toBe('0.100000')
        ->and($estimate->currency_code)->toBe('USD');

    // The ingredient's price triples afterwards. Last month's estimated margin
    // must not move — which is the entire reason this is a stored figure rather
    // than one the report recomputes.
    Ingredient::withoutTenancy()->whereKey($flour->ingredient_id)->update([
        'purchase_price_amount' => '6.000000',
    ]);

    expect((string) OrderLineEstimatedCost::withoutTenancy()->sole()->estimated_cost_amount)->toBe('0.100000');
});

it('writes no estimate at all for a line it cannot price, rather than a zero', function (): void {
    // No typed price and no weekly price: the line has no estimate. A zero here
    // would make the month's estimated margin read high and complete.
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order->refresh(), 0);

    expect(OrderLineEstimatedCost::withoutTenancy()->count())->toBe(0);
});

it('records a reservation block as its own reason, not as an empty shelf', function (): void {
    // The flour is on the shelf and the meal needs a fraction of it. What stops
    // the deduction is a confirmed batch that has claimed the lot (PROD1), and
    // that is a different problem with a different remedy — talk to the kitchen,
    // or release the claim — so it gets a reason of its own.
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');

    app(ReservationService::class)->open(
        (string) $this->organisation->getKey(),
        (string) $this->branch->getKey(),
        StockReservation::HOLDER_PRODUCTION_ORDER,
        '01a0b000-0000-7000-8000-0000000000c1',
        [(string) $flour->getKey() => '100'],
    );

    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order->refresh(), 0);

    // The confirm still stands — a kitchen has committed to cook — and nothing
    // came off a shelf somebody else is counting on.
    expect($order->refresh()->status->value)->toBe('confirmed')
        ->and(levelOf($flour))->toBe('100.0000')
        ->and(consumeMovements($order)->count())->toBe(0)
        ->and(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('reserved_for_production');
});

it('retries a blocked line once the stock item exists, deducting and auto-resolving, and is idempotent', function (): void {
    // A meal whose one ingredient has no stock item at confirm: an exception is
    // recorded and nothing is deducted (the honest fallback INV1.2 guarantees).
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'default_unit_id' => (string) $this->kg->getKey(),
    ]);

    // As above: derivation would otherwise have given it a shelf already, and
    // this test is about the retry that follows a *missing* one.
    dropDerivedStockItem($ingredient);

    $recipe = Recipe::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'yield_piece_count' => 5,
        'waste_coefficient_percent' => '0.00',
    ]);
    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'ingredient_id' => $ingredient->getKey(),
        'quantity' => '250',
        'unit_id' => (string) $this->g->getKey(),
    ]);

    $catalogue = Catalogue::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $meal = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'recipe_id' => $recipe->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order, 0);

    $exception = OrderConsumptionException::withoutTenancy()->sole();
    expect($exception->reason_code)->toBe('no_stock_item')
        ->and(consumeMovements($order)->count())->toBe(0);

    // The kitchen fixes what was missing: a stock item for the ingredient, a
    // moving-average cost, and stock on the shelf.
    $stockItem = StockItem::query()->create([
        'organisation_id' => $this->organisation->getKey(),
        'code' => 'sku-retry',
        'name_en' => 'Retry flour',
        'unit_code' => $this->kg->code,
        'unit_id' => (string) $this->kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);
    IngredientStockCost::query()->create([
        'organisation_id' => $this->organisation->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
        'unit_id' => (string) $this->kg->getKey(),
        'quantity_on_hand' => '100',
        'moving_average_cost_amount' => '2.000000',
        'last_purchase_cost_amount' => '2.000000',
        'currency_code' => 'USD',
    ]);
    $this->inventory->recordMovement(
        (string) $this->organisation->getKey(),
        (string) $this->branch->getKey(),
        (string) $stockItem->getKey(),
        'receipt',
        '100',
    );

    // Retry re-runs the line: now it consumes cleanly, so the stock drops
    // (250 g ÷ 5 = 50 g = 0.05 kg) and the exception auto-resolves.
    $service = app(OrderConsumptionService::class);
    $result = $service->retry($exception, (string) $this->tenant->user->getKey());

    expect($result->resolved_at)->not->toBeNull()
        ->and($result->resolved_by)->toBe((string) $this->tenant->user->getKey())
        ->and(levelOf($stockItem))->toBe('99.9500');

    $movement = consumeMovements($order)->sole();
    expect((string) $movement->cost_amount)->toBe('0.100000')
        ->and($movement->order_line_id)->toBe((string) $order->lines()->sole()->getKey())
        ->and($movement->sold_item_type)->toBe('meal');

    // Retrying an already-resolved exception is a no-op — no second deduction.
    $service->retry($result->refresh(), (string) $this->tenant->user->getKey());
    expect(consumeMovements($order)->count())->toBe(1)
        ->and(levelOf($stockItem))->toBe('99.9500');
});

/*
| Publishing the recipe clears `no_recipe_version`, but a version with no pieces
| produced cannot be divided per portion: the retry settles the old row and opens
| `no_yield_piece_count` on the same line — the row the retry endpoint returns in
| `still_open`, so the kitchen is told the next problem rather than "closed".
*/
it('settles no_recipe_version on retry and opens the next problem on the same line', function (): void {
    $recipe = Recipe::factory()->create(['organisation_id' => $this->organisation->getKey()]);

    $catalogue = Catalogue::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $meal = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'recipe_id' => $recipe->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);

    $order = orderFor($this, $meal, '1');
    $this->lifecycle->confirm($order, 0);

    $exception = OrderConsumptionException::withoutTenancy()->sole();
    expect($exception->reason_code)->toBe('no_recipe_version');

    // Published, but with the pieces produced left empty.
    RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'yield_piece_count' => null,
    ]);

    $result = app(OrderConsumptionService::class)->retry($exception, (string) $this->tenant->user->getKey());

    $next = OrderConsumptionException::withoutTenancy()->whereNull('resolved_at')->sole();
    expect($result->resolved_at)->not->toBeNull()
        ->and($next->reason_code)->toBe('no_yield_piece_count')
        ->and($next->order_line_id)->toBe($result->order_line_id);
});

/*
| Neither the web shop nor the order desk states a branch, and an org-wide
| delivery zone resolves to none — so at a one-branch kitchen almost every order
| arrives branchless. There is only one shelf it can have come off. Dev ran 39
| orders, 39 `no_branch` exceptions, before this.
*/
it('deducts a branchless order from the kitchen\'s only active branch', function (): void {
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);

    // A closed branch is not a shelf anything is sold from.
    OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'country_code' => $this->organisation->country_code,
        'status' => 'closed',
    ]);

    $order = orderFor($this, $meal, '1', withBranch: false);
    $this->lifecycle->confirm($order, 0);

    expect(OrderConsumptionException::withoutTenancy()->count())->toBe(0)
        ->and(consumeMovements($order)->sole()->branch_id)->toBe((string) $this->branch->getKey())
        ->and(levelOf($flour))->toBe('99.9500')
        // The order is left as it was; only the movement names the branch.
        ->and($order->refresh()->branch_id)->toBeNull();
});

it('records an order-level exception when a branchless order\'s kitchen has more than one branch', function (): void {
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);

    OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'country_code' => $this->organisation->country_code,
    ]);

    $order = orderFor($this, $meal, '1', withBranch: false);
    $this->lifecycle->confirm($order, 0);

    expect(consumeMovements($order)->count())->toBe(0)
        ->and(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('no_branch');
});

it('settles a no_branch exception on file by retrying it against the only branch', function (): void {
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);

    // The state dev is in: an order confirmed while the rule was missing.
    $order = orderFor($this, $meal, '1', withBranch: false);
    $exception = OrderConsumptionException::query()->create([
        'organisation_id' => $this->organisation->getKey(),
        'order_id' => (string) $order->getKey(),
        'reason_code' => 'no_branch',
        'detail' => 'The order has no branch, so no stock could be deducted.',
    ]);

    $result = app(OrderConsumptionService::class)->retry($exception, (string) $this->tenant->user->getKey());

    expect($result->resolved_at)->not->toBeNull()
        ->and(consumeMovements($order)->sole()->branch_id)->toBe((string) $this->branch->getKey())
        ->and(levelOf($flour))->toBe('99.9500');
});

/**
 * A kitchen's copy of `$original`'s ingredient, as editing a library row forks
 * it, with the empty shelf derivation hands every new ingredient. Returns that
 * shelf.
 */
function kitchenCopyOf(object $test, StockItem $original): StockItem
{
    $copy = Ingredient::factory()->create([
        'organisation_id' => $test->organisation->getKey(),
        'default_unit_id' => (string) Ingredient::withoutTenancy()->whereKey($original->ingredient_id)->value('default_unit_id'),
        'forked_from_ingredient_id' => $original->ingredient_id,
    ]);

    return StockItem::withoutTenancy()->where('ingredient_id', (string) $copy->getKey())->first()
        ?? StockItem::query()->create([
            'organisation_id' => $test->organisation->getKey(),
            'code' => 'copy-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => 'Copied '.fake()->word(),
            'unit_code' => $original->unit_code,
            'unit_id' => $original->unit_id,
            'ingredient_id' => (string) $copy->getKey(),
        ]);
}

it('takes a kitchen copy from its original\'s shelf while the copy\'s own shelf has never held stock', function (): void {
    // The soy sauce case: bought (and received) as the original, cooked as the copy.
    $original = stockedIngredient($this, $this->litre, '3.930000', '3', '3');
    $copyShelf = kitchenCopyOf($this, $original);

    $meal = publishedMeal($this, yieldPieceCount: 1, wastePercent: '0.00', lines: [[$copyShelf, '0.5', $this->litre]]);
    $order = orderFor($this, $meal, '1');

    $this->lifecycle->confirm($order, 0);

    $movement = consumeMovements($order)->sole();

    expect($movement->stock_item_id)->toBe((string) $original->getKey())
        ->and(levelOf($original))->toBe('2.5000')
        // Valued at the original's average, since that is what came off the shelf.
        ->and((string) $movement->unit_cost_amount)->toBe('3.930000')
        ->and(OrderConsumptionException::withoutTenancy()->count())->toBe(0);
});

it('takes a kitchen copy from its own shelf once something has been received onto it', function (): void {
    $original = stockedIngredient($this, $this->litre, '3.930000', '3', '3');
    $copyShelf = kitchenCopyOf($this, $original);

    $this->inventory->recordMovement(
        (string) $this->organisation->getKey(),
        (string) $this->branch->getKey(),
        (string) $copyShelf->getKey(),
        'receipt',
        '2',
    );

    $meal = publishedMeal($this, yieldPieceCount: 1, wastePercent: '0.00', lines: [[$copyShelf, '0.5', $this->litre]]);
    $order = orderFor($this, $meal, '1');

    $this->lifecycle->confirm($order, 0);

    expect(consumeMovements($order)->sole()->stock_item_id)->toBe((string) $copyShelf->getKey())
        ->and(levelOf($copyShelf))->toBe('1.5000')
        ->and(levelOf($original))->toBe('3.0000');
});

it('deducts a recipe in kilograms from a shelf in litres through what a litre of the ingredient weighs', function (): void {
    // 0.075 kg of soy sauce at 1080 g a litre is 75 ÷ 1080 = 0.069444 l off the shelf.
    $original = stockedIngredient($this, $this->litre, '3.930000', '3', '3');
    Ingredient::withoutTenancy()->whereKey($original->ingredient_id)->update(['grams_per_unit' => '1080']);

    // The copy was never told its weight, so it borrows the shelf ingredient's.
    $copyShelf = kitchenCopyOf($this, $original);

    $meal = publishedMeal($this, yieldPieceCount: 1, wastePercent: '0.00', lines: [[$copyShelf, '0.075', $this->kg]]);
    $order = orderFor($this, $meal, '1');

    $this->lifecycle->confirm($order, 0);

    expect(OrderConsumptionException::withoutTenancy()->count())->toBe(0)
        ->and((string) consumeMovements($order)->sole()->quantity_delta)->toBe('-0.0694')
        ->and(levelOf($original))->toBe('2.9306');
});

it('still records a unit problem when nothing says what a litre of the ingredient weighs', function (): void {
    $original = stockedIngredient($this, $this->litre, '3.930000', '3', '3');
    Ingredient::withoutTenancy()->whereKey($original->ingredient_id)->update(['grams_per_unit' => null]);

    $meal = publishedMeal($this, yieldPieceCount: 1, wastePercent: '0.00', lines: [[$original, '0.075', $this->kg]]);
    $order = orderFor($this, $meal, '1');

    $this->lifecycle->confirm($order, 0);

    expect(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('unit_conversion_unsupported')
        ->and(levelOf($original))->toBe('3.0000');
});
