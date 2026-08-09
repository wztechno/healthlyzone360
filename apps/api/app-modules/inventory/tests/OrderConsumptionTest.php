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
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Services\InventoryService;
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
        ->and($movement->cost_currency_code)->toBe('USD');

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
        ->and($movement->cost_currency_code)->toBe('USD');

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

it('records an order-level exception when the order has no branch to deduct from', function (): void {
    $flour = stockedIngredient($this, $this->kg, '2.000000', '100', '100');
    $meal = publishedMeal($this, 5, '0.00', [[$flour, '250', $this->g]]);

    $order = orderFor($this, $meal, '1', withBranch: false);
    $this->lifecycle->confirm($order, 0);

    expect(consumeMovements($order)->count())->toBe(0)
        ->and(OrderConsumptionException::withoutTenancy()->sole()->reason_code)->toBe('no_branch');
});
