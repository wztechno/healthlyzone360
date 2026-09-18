<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Enums\ReservationStatus;
use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Models\StockReservation;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Production\Enums\ProductionOrderStatus;
use Healthy360\Production\Exceptions\ProductionConsumptionRecorded;
use Healthy360\Production\Exceptions\ProductionPlanRefused;
use Healthy360\Production\Exceptions\ProductionStateInvalid;
use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Models\ProductionOrderLine;
use Healthy360\Production\Services\BatchReport;
use Healthy360\Production\Services\ProductionOrderService;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;

/*
|--------------------------------------------------------------------------
| The batch lifecycle (PROD1)
|--------------------------------------------------------------------------
|
| Money and stock under concurrency, so it is tested end to end rather than in
| pieces: what a confirm claims, what a completion moves, what it is worth, and
| the two ways a batch can stop.
|
| The arithmetic these tests pin down is the part that is easy to get wrong in a
| way nobody notices for a month: rejected units are inside produced, input waste
| is beside consumption, and process loss is neither.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('batches@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'country_code' => $this->organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation(
        (string) $this->tenant->user->getKey(),
        (string) $this->organisation->getKey(),
    );

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->litre = MeasurementUnit::query()->where('code', 'l')->sole();
    $this->piece = MeasurementUnit::query()->where('code', 'piece')->sole();

    $this->inventory = app(InventoryService::class);
    $this->orders = app(ProductionOrderService::class);

    $this->organisationId = (string) $this->organisation->getKey();
    $this->branchId = (string) $this->branch->getKey();
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * An ingredient with a shelf, a starting quantity and a moving average.
 *
 * @param  numeric-string|null  $averageCost  null leaves the ingredient unvalued, which is the `partial` case
 */
function batchIngredient(object $test, MeasurementUnit $unit, ?string $averageCost, string $onShelf, string $code = 'sku'): StockItem
{
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $test->organisation->getKey(),
        'default_unit_id' => (string) $unit->getKey(),
        // The typed purchase price is the estimating fallback the costing layer
        // reaches for when nobody has published a weekly one — which is every
        // ingredient in this world, since no receipts have been posted.
        'purchase_price_amount' => $averageCost,
        'purchase_price_currency' => $averageCost === null ? null : 'USD',
        'purchase_unit_id' => (string) $unit->getKey(),
    ]);

    /*
     * The shelf is the one the ingredient observer already derived, **not** a
     * second one created here. Two stock items against one ingredient is a real
     * shape the system allows, and `MealExplosion::resolveStockItem()` breaks the
     * tie by preferring whichever already has a level at the branch and falling
     * back to the first by code — so a helper that added a duplicate would pick
     * one or the other depending on a random code, and a produced item with no
     * opening stock would land its yield on whichever shelf sorted first that
     * day. Reading back the derived row is also what the real system does.
     */
    $item = StockItem::withoutTenancy()
        ->where('organisation_id', $test->organisation->getKey())
        ->where('ingredient_id', $ingredient->getKey())
        ->sole();

    $item->code = $code.'-'.fake()->unique()->numberBetween(1, 999999);
    $item->save();

    if ($averageCost !== null) {
        IngredientStockCost::query()->create([
            'organisation_id' => $test->organisation->getKey(),
            'ingredient_id' => (string) $ingredient->getKey(),
            'unit_id' => (string) $unit->getKey(),
            'quantity_on_hand' => $onShelf,
            'moving_average_cost_amount' => $averageCost,
            'last_purchase_cost_amount' => $averageCost,
            'currency_code' => 'USD',
        ]);
    }

    if (bccomp($onShelf, '0', 6) > 0) {
        $test->inventory->recordMovement(
            (string) $test->organisation->getKey(),
            (string) $test->branch->getKey(),
            (string) $item->getKey(),
            'receipt',
            $onShelf,
        );
    }

    return $item;
}

/**
 * A published version that makes `$outputQuantity` of `$output` from the given
 * lines. Each line is `[StockItem, quantity, MeasurementUnit]`.
 *
 * @param  list<array{0: StockItem, 1: string, 2: MeasurementUnit}>  $lines
 */
function batchRecipe(
    object $test,
    StockItem $output,
    string $outputQuantity,
    MeasurementUnit $outputUnit,
    array $lines,
    string $wastePercent = '0.00',
    int $outputCount = 1,
): RecipeVersion {
    $recipe = Recipe::factory()->create(['organisation_id' => $test->organisation->getKey()]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $test->organisation->getKey(),
        'yield_quantity' => $outputQuantity,
        'yield_unit_id' => (string) $outputUnit->getKey(),
        'yield_piece_count' => 1,
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

    RecipeVersionOutput::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $test->organisation->getKey(),
        'ingredient_id' => $output->ingredient_id,
        'output_quantity' => $outputQuantity,
        'unit_id' => (string) $outputUnit->getKey(),
        'is_primary' => true,
    ]);

    // A second output, for the co-product refusal.
    for ($extra = 1; $extra < $outputCount; $extra++) {
        $other = batchIngredient($test, $outputUnit, '1.000000', '0', 'coproduct');

        RecipeVersionOutput::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $test->organisation->getKey(),
            'ingredient_id' => $other->ingredient_id,
            'output_quantity' => '1',
            'unit_id' => (string) $outputUnit->getKey(),
            'is_primary' => false,
        ]);
    }

    return $version;
}

function shelfOf(StockItem $item): string
{
    return (string) StockLevel::withoutTenancy()->where('stock_item_id', $item->getKey())->value('quantity');
}

/**
 * @return Collection<int, StockMovement>
 */
function batchMovements(ProductionOrder $order, ?string $reason = null)
{
    $query = StockMovement::withoutTenancy()
        ->where('reference_type', ProductionOrder::MOVEMENT_REFERENCE)
        ->where('reference_id', (string) $order->getKey());

    if ($reason !== null) {
        $query->where('reason', $reason);
    }

    return $query->get();
}

/* ── drafting and confirming ─────────────────────────────────────────────── */

it('opens a draft that claims nothing at all', function (): void {
    $flour = batchIngredient($this, $this->kg, '2.000000', '100');
    $dressing = batchIngredient($this, $this->litre, null, '0', 'dressing');
    $version = batchRecipe($this, $dressing, '20', $this->litre, [[$flour, '5', $this->kg]]);

    $order = $this->orders->draft($this->organisationId, $this->branchId, $version, '40');

    expect($order->status)->toBe(ProductionOrderStatus::Draft)
        // Forty litres against a twenty-litre recipe is two batches, derived
        // here rather than by whoever filled in the form.
        ->and((string) $order->batch_factor)->toBe('2.000000')
        ->and((string) $order->planned_yield)->toBe('40.0000')
        ->and($order->reference)->toBeNull()
        // The whole point of the state: nothing is spoken for while a kitchen
        // is still deciding.
        ->and(StockReservation::withoutTenancy()->count())->toBe(0);
});

it('derives the yield when the batch factor is what was stated', function (): void {
    $flour = batchIngredient($this, $this->kg, '2.000000', '100');
    $dressing = batchIngredient($this, $this->litre, null, '0', 'dressing');
    $version = batchRecipe($this, $dressing, '20', $this->litre, [[$flour, '5', $this->kg]]);

    $order = $this->orders->draft($this->organisationId, $this->branchId, $version, null, '2.5');

    expect((string) $order->planned_yield)->toBe('50.0000');
});

it('freezes the plan, claims the stock and mints a reference on confirm', function (): void {
    $flour = batchIngredient($this, $this->kg, '2.000000', '100');
    $oil = batchIngredient($this, $this->litre, '3.000000', '50', 'oil');
    $dressing = batchIngredient($this, $this->litre, null, '0', 'dressing');

    $version = batchRecipe($this, $dressing, '20', $this->litre, [
        [$flour, '5', $this->kg],
        [$oil, '2', $this->litre],
    ]);

    $order = $this->orders->draft($this->organisationId, $this->branchId, $version, '40');
    $confirmed = $this->orders->confirm($order);

    expect($confirmed->status)->toBe(ProductionOrderStatus::Confirmed)
        ->and($confirmed->reference)->toStartWith('PB-')
        ->and($confirmed->confirmed_at)->not->toBeNull()
        ->and($confirmed->production_item_ingredient_id)->toBe((string) $dressing->ingredient_id);

    /** @var list<ProductionOrderLine> $lines */
    $lines = $confirmed->lines()->orderBy('display_order')->get()->all();

    expect($lines)->toHaveCount(2);

    $flourLine = collect($lines)->firstWhere('stock_item_id', (string) $flour->getKey());

    // Two batches of a five-kilo line is ten kilos, claimed rather than merely
    // required.
    expect((string) $flourLine->required_quantity)->toBe('10.0000')
        ->and((string) $flourLine->reserved_quantity)->toBe('10.0000')
        ->and($flourLine->line_kind)->toBe(ProductionOrderLine::KIND_INGREDIENT);

    expect(StockReservation::withoutTenancy()->where('status', ReservationStatus::Open->value)->count())->toBe(2);

    // Nothing has moved: a confirm is a promise, not a deduction.
    expect(shelfOf($flour))->toBe('100.0000')
        ->and(batchMovements($confirmed))->toHaveCount(0);
});

it('snapshots the estimate at the prices of the moment', function (): void {
    $flour = batchIngredient($this, $this->kg, '2.000000', '100');
    $dressing = batchIngredient($this, $this->litre, null, '0', 'dressing');
    $version = batchRecipe($this, $dressing, '20', $this->litre, [[$flour, '5', $this->kg]]);

    $confirmed = $this->orders->confirm($this->orders->draft($this->organisationId, $this->branchId, $version, '40'));

    // Ten kilos of flour at two dollars, from the ingredient's typed cost —
    // there are no weekly prices in this world, so the fallback stands and says
    // so rather than leaving the line uncosted.
    expect((string) $confirmed->estimated_cost_amount)->toBe('20.000000')
        ->and($confirmed->estimated_cost_currency_code)->toBe('USD');

    $line = $confirmed->lines()->sole();

    expect($line->cost_source)->toBe(ProductionOrderLine::SOURCE_FALLBACK)
        ->and((string) $line->fallback_unit_cost_amount)->toBe('2.000000');
});

it('refuses a confirm against a shelf it cannot claim', function (): void {
    // Two kilos on the shelf and ten needed. The desk shows `missing` before
    // anybody presses the button; a confirm that reserved what it could would be
    // a promise the system knows it cannot keep.
    $flour = batchIngredient($this, $this->kg, '2.000000', '2');
    $dressing = batchIngredient($this, $this->litre, null, '0', 'dressing');
    $version = batchRecipe($this, $dressing, '20', $this->litre, [[$flour, '5', $this->kg]]);

    $order = $this->orders->draft($this->organisationId, $this->branchId, $version, '40');

    expect(fn () => $this->orders->confirm($order))->toThrow(InsufficientStock::class);

    expect($order->refresh()->status)->toBe(ProductionOrderStatus::Draft)
        ->and(StockReservation::withoutTenancy()->count())->toBe(0)
        ->and(ProductionOrderLine::withoutTenancy()->count())->toBe(0);
});

it('refuses a version that makes two things, rather than guessing how to split the cost', function (): void {
    $flour = batchIngredient($this, $this->kg, '2.000000', '100');
    $dressing = batchIngredient($this, $this->litre, null, '0', 'dressing');
    $version = batchRecipe($this, $dressing, '20', $this->litre, [[$flour, '5', $this->kg]], outputCount: 2);

    try {
        $this->orders->draft($this->organisationId, $this->branchId, $version, '40');
        $this->fail('Expected a co-product refusal.');
    } catch (ProductionPlanRefused $e) {
        expect($e->details['reason'])->toBe('multiple_outputs');
    }
});

/* ── completing ──────────────────────────────────────────────────────────── */

/**
 * A confirmed, started batch of two × (5 kg flour → 20 l dressing).
 *
 * @return array{0: ProductionOrder, 1: StockItem, 2: StockItem}
 */
function startedBatch(object $test, ?string $flourCost = '2.000000'): array
{
    $flour = batchIngredient($test, $test->kg, $flourCost, '100');
    $dressing = batchIngredient($test, $test->litre, null, '0', 'dressing');
    $version = batchRecipe($test, $dressing, '20', $test->litre, [[$flour, '5', $test->kg]]);

    $order = $test->orders->confirm($test->orders->draft(
        (string) $test->organisation->getKey(),
        (string) $test->branch->getKey(),
        $version,
        '40',
    ));

    return [$test->orders->start($order), $flour, $dressing];
}

it('values a batch at what went into it, divided over what came out', function (): void {
    [$order, $flour, $dressing] = startedBatch($this);

    $completed = $this->orders->complete($order, new BatchReport(producedQuantity: '38'));

    // Ten kilos at two dollars is twenty; thirty-eight litres came out, so a
    // litre cost 20 ÷ 38. The two litres that evaporated have no money of their
    // own — their cost is exactly this division.
    expect($completed->status)->toBe(ProductionOrderStatus::Completed)
        ->and($completed->actual_cost_status)->toBe(ProductionOrder::COST_COMPLETE)
        ->and((string) $completed->actual_cost_amount)->toBe('20.000000')
        ->and((string) $completed->actual_unit_cost_amount)->toBe('0.526316')
        ->and($completed->yieldVariance())->toBe('-2.0000');

    expect(shelfOf($flour))->toBe('90.0000')
        ->and(shelfOf($dressing))->toBe('38.0000');

    // Process loss posts no movement: it never existed as stock.
    expect(batchMovements($completed, 'waste'))->toHaveCount(0);
});

it('yields the whole batch and then wastes the rejected part, netting to what is usable', function (): void {
    [$order, $flour, $dressing] = startedBatch($this);

    $completed = $this->orders->complete($order, new BatchReport(
        producedQuantity: '38',
        rejectedQuantity: '3',
    ));

    // Thirty-eight went on the shelf and three came back off at the batch's own
    // unit cost, so the money follows the unit rather than vanishing.
    expect($completed->usableYieldQuantity())->toBe('35.0000')
        ->and(shelfOf($dressing))->toBe('35.0000');

    $yield = batchMovements($completed, 'yield')->sole();
    $waste = batchMovements($completed, 'waste')->sole();

    expect((string) $yield->quantity_delta)->toBe('38.0000')
        ->and((string) $waste->quantity_delta)->toBe('-3.0000')
        ->and((string) $waste->unit_cost_amount)->toBe('0.526316');
});

it('takes input waste off the shelf beside consumption, and keeps it out of the batch cost', function (): void {
    [$order, $flour, $dressing] = startedBatch($this);

    $completed = $this->orders->complete($order, new BatchReport(
        producedQuantity: '38',
        consumed: [(string) $flour->getKey() => '9'],
        waste: [(string) $flour->getKey() => '1'],
    ));

    // The shelf falls by ten — nine into the pot and one on the floor — as two
    // movements with different reasons.
    expect(shelfOf($flour))->toBe('90.0000');

    $line = $completed->lines()->sole();

    expect((string) $line->consumed_quantity)->toBe('9.0000')
        ->and((string) $line->waste_quantity)->toBe('1.0000');

    // Eighteen dollars, not twenty: the dropped kilo never became product, and
    // charging it to the dressing would put the accident into the price of the
    // food.
    expect((string) $completed->actual_cost_amount)->toBe('18.000000');
});

it('deducts once when a completion is delivered twice', function (): void {
    [$order, $flour, $dressing] = startedBatch($this);

    $report = new BatchReport(producedQuantity: '38');

    $first = $this->orders->complete($order, $report);
    $second = $this->orders->complete($first, $report);

    expect($second->status)->toBe(ProductionOrderStatus::Completed)
        ->and(shelfOf($flour))->toBe('90.0000')
        ->and(shelfOf($dressing))->toBe('38.0000')
        ->and(batchMovements($second))->toHaveCount(2);
});

it('records a batch that produced nothing as loss rather than as cost of goods', function (): void {
    [$order, $flour, $dressing] = startedBatch($this);

    $completed = $this->orders->complete($order, new BatchReport(producedQuantity: '0'));

    // Nothing was transformed, so nothing was consumed — it was all lost. The
    // monthly report reads waste where a reader actually looks for it.
    expect(batchMovements($completed, 'consume'))->toHaveCount(0)
        ->and(batchMovements($completed, 'waste'))->toHaveCount(1)
        ->and(batchMovements($completed, 'yield'))->toHaveCount(0);

    expect(shelfOf($flour))->toBe('90.0000')
        ->and(StockLevel::withoutTenancy()->where('stock_item_id', $dressing->getKey())->exists())->toBeFalse();

    // No division, and therefore no unit cost.
    expect($completed->actual_unit_cost_amount)->toBeNull();
});

it('takes the dropped input off the shelf too when the batch produced nothing', function (): void {
    [$order, $flour, $dressing] = startedBatch($this);

    // Nine into the pot and one on the floor. Nothing came out, so both endings
    // were the same and they post as one waste movement rather than two — a
    // second `waste` row for the same shelf would be skipped as a duplicate by
    // the idempotency guard and the dropped kilo would never leave the shelf.
    $completed = $this->orders->complete($order, new BatchReport(
        producedQuantity: '0',
        consumed: [(string) $flour->getKey() => '9'],
        waste: [(string) $flour->getKey() => '1'],
    ));

    expect(shelfOf($flour))->toBe('90.0000')
        ->and(batchMovements($completed, 'waste'))->toHaveCount(1)
        ->and((string) batchMovements($completed, 'waste')->sole()->quantity_delta)->toBe('-10.0000');
});

it('blends the finished batch into the produced ingredient’s average', function (): void {
    [$order, $flour, $dressing] = startedBatch($this);

    $this->orders->complete($order, new BatchReport(producedQuantity: '40'));

    $cost = IngredientStockCost::withoutTenancy()
        ->where('ingredient_id', $dressing->ingredient_id)
        ->sole();

    // Twenty dollars over forty litres, onto an empty shelf.
    expect((string) $cost->moving_average_cost_amount)->toBe('0.500000')
        ->and((string) $cost->quantity_on_hand)->toBe('40.000000')
        ->and($cost->currency_code)->toBe('USD')
        // A batch is not a payment, so the supplier-price column is untouched.
        ->and($cost->last_purchase_cost_amount)->toBeNull();
});

it('withholds the unit cost and leaves the average alone when an input is unvalued', function (): void {
    [$order, $flour, $dressing] = startedBatch($this, flourCost: null);

    $completed = $this->orders->complete($order, new BatchReport(producedQuantity: '40'));

    // The stock moved — a kitchen that cooked is never blocked on arithmetic —
    // and the valuation says so rather than publishing a total that is real and
    // too small.
    expect(shelfOf($flour))->toBe('90.0000')
        ->and(shelfOf($dressing))->toBe('40.0000')
        ->and($completed->actual_cost_status)->toBe(ProductionOrder::COST_UNVALUED)
        ->and($completed->actual_unit_cost_amount)->toBeNull()
        ->and($completed->valuation_note)->not->toBeNull();

    // The basis did not move: blending a partial figure would corrupt every
    // later sale's cost of goods.
    expect(IngredientStockCost::withoutTenancy()->where('ingredient_id', $dressing->ingredient_id)->exists())->toBeFalse();
});

it('closes the claims as consumed when the batch finishes', function (): void {
    [$order] = startedBatch($this);

    $this->orders->complete($order, new BatchReport(producedQuantity: '40'));

    expect(StockReservation::withoutTenancy()->where('status', ReservationStatus::Open->value)->count())->toBe(0)
        ->and(StockReservation::withoutTenancy()->where('status', ReservationStatus::Consumed->value)->count())->toBe(1);
});

/* ── stopping ────────────────────────────────────────────────────────────── */

it('cancels a confirmed batch by releasing its claims and deducting nothing', function (): void {
    $flour = batchIngredient($this, $this->kg, '2.000000', '100');
    $dressing = batchIngredient($this, $this->litre, null, '0', 'dressing');
    $version = batchRecipe($this, $dressing, '20', $this->litre, [[$flour, '5', $this->kg]]);

    $order = $this->orders->confirm($this->orders->draft($this->organisationId, $this->branchId, $version, '40'));
    $cancelled = $this->orders->cancel($order);

    expect($cancelled->status)->toBe(ProductionOrderStatus::Cancelled)
        ->and(shelfOf($flour))->toBe('100.0000')
        ->and(batchMovements($cancelled))->toHaveCount(0);

    // Released, never consumed: a manager reading this order sees that the batch
    // did not take the flour rather than inferring it from an absence.
    expect(StockReservation::withoutTenancy()->sole()->status)->toBe(ReservationStatus::Released);
});

it('refuses to cancel a batch that has already taken stock, and names abandon', function (): void {
    // A batch that has eaten a kilo of flour did not un-happen, so cancelling it
    // would leave that kilo missing with nothing on the order to explain it.
    [$second, $secondFlour] = startedBatch($this);

    $this->inventory->recordMovement(
        $this->organisationId,
        $this->branchId,
        (string) $secondFlour->getKey(),
        'consume',
        '-1',
        ProductionOrder::MOVEMENT_REFERENCE,
        (string) $second->getKey(),
        holderType: StockReservation::HOLDER_PRODUCTION_ORDER,
        holderId: (string) $second->getKey(),
    );

    try {
        $this->orders->cancel($second);
        $this->fail('Expected the cancellation to be refused.');
    } catch (ProductionConsumptionRecorded $e) {
        expect($e->details['use_instead'])->toBe('abandon')
            ->and($e->details['movement_count'])->toBe(1);
    }

    expect($second->refresh()->status)->toBe(ProductionOrderStatus::InProduction);
});

it('abandons a started batch, recording what was used and what came out', function (): void {
    [$order, $flour, $dressing] = startedBatch($this);

    $abandoned = $this->orders->abandon(
        $order,
        new BatchReport(producedQuantity: '5', consumed: [(string) $flour->getKey() => '10']),
        'The mixer failed halfway through.',
    );

    expect($abandoned->status)->toBe(ProductionOrderStatus::Abandoned)
        ->and($abandoned->abandon_reason)->toBe('The mixer failed halfway through.')
        ->and($abandoned->abandoned_at)->not->toBeNull()
        // `abandoned` always may carry movements — that is the whole reason it
        // is a different word from `cancelled`.
        ->and(batchMovements($abandoned))->not->toHaveCount(0)
        ->and(shelfOf($flour))->toBe('90.0000')
        ->and(shelfOf($dressing))->toBe('5.0000');
});

it('refuses an edge the batch’s state does not allow, and says which are allowed', function (): void {
    $flour = batchIngredient($this, $this->kg, '2.000000', '100');
    $dressing = batchIngredient($this, $this->litre, null, '0', 'dressing');
    $version = batchRecipe($this, $dressing, '20', $this->litre, [[$flour, '5', $this->kg]]);

    $draft = $this->orders->draft($this->organisationId, $this->branchId, $version, '40');

    try {
        // A draft has not been confirmed, so there is nothing to start.
        $this->orders->start($draft);
        $this->fail('Expected the start to be refused.');
    } catch (ProductionStateInvalid $e) {
        expect($e->details['status'])->toBe('draft')
            ->and($e->details['allowed'])->toBe(['confirmed', 'cancelled']);
    }
});
