<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Database\Factories\SalesChannelFactory;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ProductionMode;
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
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Production\Services\BatchReport;
use Healthy360\Production\Services\ProductionOrderService;
use Healthy360\Recipes\Enums\PackagingBasis;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Recipes\Services\RecipeNutritionService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| The two journeys the requirement names (PROD1)
|--------------------------------------------------------------------------
|
| Every other suite in this module tests one service. These two walk the whole
| thing the way a kitchen does, because the failures worth catching here are
| *between* the parts: a batch that costs correctly and then sells its raw
| ingredients a second time is two correct services and one wrong product.
|
| **Frozen meals.** Publish a version that makes forty trays, catalogue them,
| plan the batch, confirm it, watch the external desk refuse to eat the flour it
| claimed, complete it with a real yield — thirty-eight made, one dropped, half a
| kilo of flour on the floor — and then sell five. What is pinned at the end is
| the subtraction that must *not* happen: the flour and the trays do not move
| again when the tray is sold, because they were already spent making it.
|
| **Dressing into salads.** Produce twenty litres of Caesar dressing, list it in
| a salad at thirty millilitres, and sell the salad. The dressing comes off its
| own shelf; the mayonnaise and lemon it was made from do not move at all, and
| the salad's sheet lists the dressing rather than re-expanding into them. That
| is the whole point of an intermediate: its cost and its nutrition are claimed
| once, by the batch that made it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    // The full kitchen manager plus the two cost codes the fixture's own list
    // omits: a technical sheet is money, and the production desk is money again.
    $this->tenant = PricingWorld::kitchen('acceptance@kitchen.test', [
        ...PricingWorld::FULL_PERMISSIONS,
        'recipe.view_costs_organisation',
        'production.view_organisation',
        'production.manage_organisation',
        'production.view_costs_organisation',
    ]);
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
    $this->millilitre = MeasurementUnit::query()->where('code', 'ml')->sole();
    $this->piece = MeasurementUnit::query()->where('code', 'piece')->sole();

    $this->inventory = app(InventoryService::class);
    $this->batches = app(ProductionOrderService::class);
    $this->lifecycle = app(OrderLifecycle::class);

    $this->organisationId = (string) $this->organisation->getKey();
    $this->branchId = (string) $this->branch->getKey();
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * An ingredient with its derived shelf, an opening quantity and a valuation.
 *
 * The shelf is the one the ingredient observer already derived rather than a
 * second one: two stock items against one ingredient is a shape the system
 * allows, and the explosion breaks the tie by code — so a helper that added a
 * duplicate would put a batch's yield on whichever code sorted first that day.
 *
 * @param  numeric-string|null  $averageCost  null leaves the ingredient unvalued
 * @param  numeric-string  $onShelf
 * @return array{0: Ingredient, 1: StockItem}
 */
function acceptanceIngredient(
    object $test,
    string $code,
    MeasurementUnit $unit,
    ?string $averageCost,
    string $onShelf,
): array {
    /** @var Ingredient $ingredient */
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $test->organisationId,
        'default_unit_id' => (string) $unit->getKey(),
        // The typed purchase price is the estimating fallback the costing layer
        // reaches for where no weekly price has been published — which is every
        // ingredient in this world, since it posts no receipts.
        'purchase_price_amount' => $averageCost,
        'purchase_price_currency' => $averageCost === null ? null : 'USD',
        'purchase_unit_id' => (string) $unit->getKey(),
    ]);

    /** @var StockItem $item */
    $item = StockItem::withoutTenancy()
        ->where('organisation_id', $test->organisationId)
        ->where('ingredient_id', $ingredient->getKey())
        ->sole();

    $item->code = $code;
    $item->name_en = ucfirst(str_replace('-', ' ', $code));
    $item->save();

    if ($averageCost !== null) {
        IngredientStockCost::query()->create([
            'organisation_id' => $test->organisationId,
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
            $test->organisationId,
            $test->branchId,
            (string) $item->getKey(),
            'receipt',
            $onShelf,
        );
    }

    return [$ingredient, $item];
}

/**
 * A published version making `$outputQuantity` of `$output`, with lines and
 * optional packaging.
 *
 * @param  list<array{0: Ingredient, 1: string, 2: MeasurementUnit}>  $lines
 * @param  list<array{0: Ingredient, 1: string, 2: MeasurementUnit}>  $packaging
 */
function acceptanceRecipe(
    object $test,
    ?Ingredient $output,
    string $outputQuantity,
    MeasurementUnit $outputUnit,
    array $lines,
    array $packaging = [],
): RecipeVersion {
    $recipe = Recipe::factory()->create(['organisation_id' => $test->organisationId]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $test->organisationId,
        'yield_quantity' => $outputQuantity,
        'yield_unit_id' => (string) $outputUnit->getKey(),
        'yield_piece_count' => 1,
        'waste_coefficient_percent' => '0.00',
        'packaging_waste_percent' => '0.00',
    ]);

    $lineNumber = 1;

    foreach ($lines as [$ingredient, $quantity, $unit]) {
        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $test->organisationId,
            'line_number' => $lineNumber++,
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => $quantity,
            'unit_id' => (string) $unit->getKey(),
        ]);
    }

    $packagingLine = 1;

    foreach ($packaging as [$ingredient, $quantity, $unit]) {
        RecipeVersionPackaging::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $test->organisationId,
            'line_number' => $packagingLine++,
            'ingredient_id' => (string) $ingredient->getKey(),
            // Typed and taken once per run: a batch label or a case of trays.
            // The two computed bases need a stated container capacity, which is
            // a different feature's fixture and not what these journeys are
            // about.
            'basis' => PackagingBasis::PerBatch,
            'quantity' => $quantity,
            'unit_id' => (string) $unit->getKey(),
        ]);
    }

    if ($output !== null) {
        RecipeVersionOutput::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $test->organisationId,
            'ingredient_id' => (string) $output->getKey(),
            'output_quantity' => $outputQuantity,
            'unit_id' => (string) $outputUnit->getKey(),
            'is_primary' => true,
        ]);

        // The claim `RecipeOutputNutritionWriter` makes when a version with an
        // output is published, stated here because these fixtures build the
        // version rather than publishing one through the service. It is the
        // claim that matters: costing follows exactly the version that claims
        // the ingredient's nutrition, so a produced component can never be
        // costed by one recipe and described by another.
        $output->nutrition_derived_from_version_id = (string) $version->getKey();
        $output->save();
    }

    return $version;
}

/** A published sellable, backed either by a recipe or by an ingredient's shelf. */
function acceptanceSellable(object $test, array $attributes): CatalogueItem
{
    $catalogue = Catalogue::factory()->create(['organisation_id' => $test->organisationId]);

    /** @var CatalogueItem $item */
    $item = CatalogueItem::factory()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $test->organisationId,
        'status' => CatalogueItemStatus::Published,
    ] + $attributes);

    return $item;
}

/** An order for this kitchen with one line, ready to confirm. */
function acceptanceOrder(object $test, CatalogueItem $item, string $quantity): Order
{
    $customer = CustomerAccountFactory::new()->create();
    $channel = SalesChannelFactory::new()->create(['organisation_id' => $test->organisationId]);

    $order = Order::factory()->create([
        'organisation_id' => $test->organisationId,
        'customer_account_id' => $customer->getKey(),
        'sales_channel_id' => $channel->getKey(),
        'branch_id' => $test->branch->getKey(),
    ]);

    OrderLine::factory()->create([
        'order_id' => $order->getKey(),
        'catalogue_item_id' => $item->getKey(),
        'quantity' => $quantity,
    ]);

    return $order;
}

function acceptanceShelf(StockItem $item): string
{
    return (string) StockLevel::withoutTenancy()->where('stock_item_id', $item->getKey())->value('quantity');
}

/* ── one: frozen meals, made in a batch and sold by the unit ───────────────── */

it('makes forty trays, loses two to the process and one to the bin, and sells five without buying flour twice', function (): void {
    [$flourIngredient, $flour] = acceptanceIngredient($this, 'flour', $this->kg, '2.000000', '100');
    [$trayIngredient, $tray] = acceptanceIngredient($this, 'tray', $this->piece, '0.500000', '100');
    [$lasagneIngredient, $lasagne] = acceptanceIngredient($this, 'lasagne', $this->piece, null, '0');

    $version = acceptanceRecipe(
        $this,
        $lasagneIngredient,
        '40',
        $this->piece,
        [[$flourIngredient, '8', $this->kg]],
        [[$trayIngredient, '40', $this->piece]],
    );

    // ── plan ──────────────────────────────────────────────────────────────
    $draft = $this->batches->draft($this->organisationId, $this->branchId, $version, '40');
    $plan = $this->batches->plan($draft);

    expect((string) $plan->batchFactor)->toBe('1.000000')
        ->and($plan->ingredients)->toHaveCount(1)
        ->and($plan->packaging)->toHaveCount(1)
        ->and($plan->ingredients[0]->required)->toBe('8.000000')
        ->and($plan->ingredients[0]->onHand)->toBe('100.0000')
        ->and($plan->ingredients[0]->missing)->toBe('0.0000')
        ->and($plan->isConfirmable())->toBeTrue()
        // 8 kg at 2.00 plus 40 trays at 0.50.
        ->and($plan->estimatedCostAmount)->toBe('36.000000')
        ->and($plan->currencyCode)->toBe('USD');

    // ── confirm: the flour is claimed, and the desk can no longer eat it ───
    $confirmed = $this->batches->confirm($draft);

    // A **meal**, explicitly: the sale path is chosen by what the item is, and
    // a meal explodes its recipe where a product sells off a shelf. The default
    // factory type is a product, which would resolve to a finished-stock sale
    // against an item that has no ingredient at all.
    $hungry = acceptanceSellable($this, [
        'item_type' => CatalogueItemType::Meal,
        'recipe_id' => acceptanceRecipe($this, null, '1', $this->piece, [[$flourIngredient, '95', $this->kg]])->recipe_id,
    ]);

    $order = acceptanceOrder($this, $hungry, '1');
    $this->lifecycle->confirm($order, $order->lock_version);

    // Ninety-five kilos against ninety-two available. The sale is *not* refused
    // — a customer waiting on food is not turned away over a stock count — but
    // the shortfall is recorded, named, and queued for somebody to resolve.
    $exception = OrderConsumptionException::withoutTenancy()
        ->where('order_id', (string) $order->getKey())
        ->sole();

    expect($exception->reason_code)->toBe('reserved_for_production')
        ->and(acceptanceShelf($flour))->toBe('100.0000');

    // ── produce ───────────────────────────────────────────────────────────
    $started = $this->batches->start($confirmed);

    $completed = $this->batches->complete($started, new BatchReport(
        producedQuantity: '38',
        rejectedQuantity: '1',
        // Flour and trays as claimed; half a kilo of flour went on the floor.
        waste: [(string) $flour->getKey() => '0.5'],
        productionDate: '2026-09-16',
        storageLocation: 'Freezer 2',
        expiryDate: '2027-03-16',
    ));

    expect(acceptanceShelf($flour))->toBe('91.5000')
        ->and(acceptanceShelf($tray))->toBe('60.0000')
        // Thirty-eight came out and one was thrown away: the shelf nets to the
        // thirty-seven that are actually there.
        ->and(acceptanceShelf($lasagne))->toBe('37.0000');

    // Thirty-six dollars of inputs — the dropped half kilo never became product
    // and is not charged to the food — over the thirty-eight that came out. The
    // two trays lost to the process carry no money of their own: their cost is
    // exactly this division.
    expect((string) $completed->actual_cost_amount)->toBe('36.000000')
        ->and((string) $completed->actual_unit_cost_amount)->toBe('0.947368')
        ->and($completed->actual_cost_status)->toBe('complete')
        ->and((string) $completed->usableYieldQuantity())->toBe('37.0000')
        ->and((string) $completed->yieldVariance())->toBe('-2.0000')
        // The first lot of the 16th: 260916, sequence 001, check digit 7.
        ->and($completed->lot_number)->toBe('2609160017');

    // ── sell five ─────────────────────────────────────────────────────────
    $frozenMeal = acceptanceSellable($this, [
        'ingredient_id' => (string) $lasagneIngredient->getKey(),
        'item_type' => CatalogueItemType::FrozenMeal,
        'production_mode' => ProductionMode::Production,
    ]);

    $sale = acceptanceOrder($this, $frozenMeal, '5');
    $this->lifecycle->confirm($sale, $sale->lock_version);

    expect(acceptanceShelf($lasagne))->toBe('32.0000')
        // **The whole point of the journey.** The flour and the trays were spent
        // making these trays; taking them again when one is sold would bill the
        // kitchen twice for the same food and leave the shelf count lying.
        ->and(acceptanceShelf($flour))->toBe('91.5000')
        ->and(acceptanceShelf($tray))->toBe('60.0000');

    $sold = StockMovement::withoutTenancy()
        ->where('reference_type', 'order')
        ->where('reference_id', (string) $sale->getKey())
        ->where('reason', 'consume')
        ->get();

    // One movement, on the finished shelf, valued at what the batch actually
    // cost to make rather than at what its ingredients cost to buy.
    expect($sold)->toHaveCount(1)
        ->and((string) $sold[0]->stock_item_id)->toBe((string) $lasagne->getKey())
        ->and((string) $sold[0]->quantity_delta)->toBe('-5.0000')
        ->and((string) $sold[0]->unit_cost_amount)->toBe('0.947368');
});

/* ── two: a dressing produced once and drawn on by the salads ──────────────── */

it('produces twenty litres of dressing and sells a salad that draws on it, not on its raw materials', function (): void {
    [$mayoIngredient, $mayo] = acceptanceIngredient($this, 'mayonnaise', $this->litre, '5.000000', '50');
    [$lemonIngredient, $lemon] = acceptanceIngredient($this, 'lemon-juice', $this->litre, '3.000000', '20');
    [$dressingIngredient, $dressing] = acceptanceIngredient($this, 'caesar-dressing', $this->litre, null, '0');

    $dressingVersion = acceptanceRecipe(
        $this,
        $dressingIngredient,
        '20',
        $this->litre,
        [
            [$mayoIngredient, '15', $this->litre],
            [$lemonIngredient, '5', $this->litre],
        ],
    );

    $batch = $this->batches->draft($this->organisationId, $this->branchId, $dressingVersion, '20');
    $completed = $this->batches->complete(
        $this->batches->start($this->batches->confirm($batch)),
        new BatchReport(producedQuantity: '20'),
    );

    // Seventy-five plus fifteen over twenty litres.
    expect((string) $completed->actual_cost_amount)->toBe('90.000000')
        ->and((string) $completed->actual_unit_cost_amount)->toBe('4.500000')
        ->and(acceptanceShelf($dressing))->toBe('20.0000')
        ->and(acceptanceShelf($mayo))->toBe('35.0000')
        ->and(acceptanceShelf($lemon))->toBe('15.0000');

    // ── a salad that lists the dressing, not the mayonnaise ───────────────
    [$lettuceIngredient, $lettuce] = acceptanceIngredient($this, 'lettuce', $this->kg, '4.000000', '10');

    $saladVersion = acceptanceRecipe(
        $this,
        null,
        '1',
        $this->piece,
        [
            [$lettuceIngredient, '0.2', $this->kg],
            [$dressingIngredient, '30', $this->millilitre],
        ],
    );

    $salad = acceptanceSellable($this, [
        'item_type' => CatalogueItemType::Meal,
        'recipe_id' => $saladVersion->recipe_id,
    ]);

    $sale = acceptanceOrder($this, $salad, '1');
    $this->lifecycle->confirm($sale, $sale->lock_version);

    // Thirty millilitres of a litre-counted shelf.
    expect(acceptanceShelf($dressing))->toBe('19.9700')
        ->and(acceptanceShelf($lettuce))->toBe('9.8000')
        // **The whole point of an intermediate.** The mayonnaise and the lemon
        // were spent making the dressing; re-expanding the dressing at the point
        // of sale would take them a second time and leave twenty litres of
        // dressing on the shelf that nothing had paid for.
        ->and(acceptanceShelf($mayo))->toBe('35.0000')
        ->and(acceptanceShelf($lemon))->toBe('15.0000');

    $drawn = StockMovement::withoutTenancy()
        ->where('reference_type', 'order')
        ->where('reference_id', (string) $sale->getKey())
        ->where('reason', 'consume')
        ->get()
        ->keyBy(fn (StockMovement $movement): string => (string) $movement->stock_item_id);

    expect($drawn)->toHaveCount(2)
        ->and($drawn->has((string) $dressing->getKey()))->toBeTrue()
        ->and($drawn->has((string) $mayo->getKey()))->toBeFalse()
        // The dressing costs the salad what the batch cost to make: 4.50 a
        // litre, which is 0.135 for thirty millilitres.
        ->and((string) $drawn[(string) $dressing->getKey()]->unit_cost_amount)->toBe('4.500000');
});

it('costs a salad from the dressing that makes it, and never re-expands into mayonnaise', function (): void {
    [$mayoIngredient] = acceptanceIngredient($this, 'mayonnaise', $this->litre, '5.000000', '50');
    [$lemonIngredient] = acceptanceIngredient($this, 'lemon-juice', $this->litre, '3.000000', '20');
    [$dressingIngredient] = acceptanceIngredient($this, 'caesar-dressing', $this->litre, null, '0');
    [$lettuceIngredient] = acceptanceIngredient($this, 'lettuce', $this->kg, '4.000000', '10');

    acceptanceRecipe($this, $dressingIngredient, '20', $this->litre, [
        [$mayoIngredient, '15', $this->litre],
        [$lemonIngredient, '5', $this->litre],
    ]);

    $saladVersion = acceptanceRecipe($this, null, '1', $this->piece, [
        [$lettuceIngredient, '0.2', $this->kg],
        [$dressingIngredient, '30', $this->millilitre],
    ]);

    $this->actingAs($this->tenant->user);

    $sheet = $this->getJson(
        '/api/v1/catalogue/recipes/'.(string) $saladVersion->recipe_id.'/versions/'.(string) $saladVersion->version_number.'/technical-sheet',
        PricingWorld::headers($this->tenant),
    )->assertOk();

    /** @var list<array<string, mixed>> $lines */
    $lines = $sheet->json('data.lines');
    $ingredientIds = array_map(static fn (array $line): string => (string) $line['ingredient_id'], $lines);

    // Two lines, and the dressing is one of them. The mayonnaise and the lemon
    // belong to the dressing's own sheet: charging them here as well would count
    // the same litre of mayonnaise twice, once in the batch and once in every
    // salad the batch goes into.
    expect($ingredientIds)->toHaveCount(2)
        ->and($ingredientIds)->toContain((string) $dressingIngredient->getKey())
        ->and($ingredientIds)->not->toContain((string) $mayoIngredient->getKey())
        ->and($ingredientIds)->not->toContain((string) $lemonIngredient->getKey());

    /** @var list<array<string, mixed>> $sources */
    $sources = $sheet->json('data.weekly.line_sources');
    $byIngredient = array_column($sources, null, 'ingredient_id');

    $dressingSource = $byIngredient[(string) $dressingIngredient->getKey()] ?? null;

    // The dressing is priced by the version that makes it — §H's rule, and the
    // same version that claims its nutrition, so cost and nutrition can never
    // name two different recipes. The lettuce falls back to what somebody typed.
    expect($dressingSource)->not->toBeNull()
        ->and($dressingSource['cost_source'])->toBe('component_recipe')
        ->and($dressingSource['source_recipe_version_id'])->not->toBeNull()
        // 90.00 over 20 litres, expressed in the millilitres the salad measures
        // in: the explosion converts, so the sheet does not have to.
        ->and($dressingSource['unit_cost_amount'])->toBe('0.004500');
});

it('either carries the dressing into the salad nutrition or withholds it by name, and never silently part of it', function (): void {
    [$mayoIngredient] = acceptanceIngredient($this, 'mayonnaise', $this->litre, '5.000000', '50');
    [$dressingIngredient] = acceptanceIngredient($this, 'caesar-dressing', $this->litre, null, '0');
    [$lettuceIngredient] = acceptanceIngredient($this, 'lettuce', $this->kg, '4.000000', '10');

    // The lettuce is weighed and described; the dressing, for now, is neither.
    $lettuceIngredient->grams_per_unit = '1000';
    $lettuceIngredient->nutrition_per_100g = RecipeWorld::nutritionEnvelope([
        'energy' => 15, 'protein' => 1.4, 'carbohydrate' => 2.9,
        'fat' => 0.2, 'fibre' => 1.3, 'sugars' => 0.8, 'sodium' => 28,
    ]);
    $lettuceIngredient->save();

    acceptanceRecipe($this, $dressingIngredient, '20', $this->litre, [[$mayoIngredient, '20', $this->litre]]);

    $saladVersion = acceptanceRecipe($this, null, '1', $this->piece, [
        [$lettuceIngredient, '0.2', $this->kg],
        [$dressingIngredient, '30', $this->millilitre],
    ]);

    $nutrition = app(RecipeNutritionService::class);
    $lines = RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $saladVersion->getKey())->get();

    $withheld = $nutrition->forVersion($saladVersion, $lines);

    // Thirty millilitres of dressing is a volume and a nutrition label is per
    // hundred grams, so without a density there is no honest conversion. The
    // lettuce alone would be a label short by exactly one ingredient, which
    // reads identically to a correct one — so it is withheld, and the thing
    // missing is named rather than left for somebody to work out.
    expect($withheld->isComplete())->toBeFalse()
        ->and(array_column($withheld->unresolved, 'ingredient_id'))
        ->toContain((string) $dressingIngredient->getKey());

    // ── give it a density and facts, and the salad's label completes ───────
    $dressingIngredient->grams_per_unit = '1000';
    $dressingIngredient->nutrition_per_100g = RecipeWorld::nutritionEnvelope([
        'energy' => 480, 'protein' => 1.1, 'carbohydrate' => 2.4,
        'fat' => 51, 'fibre' => 0.1, 'sugars' => 1.9, 'sodium' => 740,
    ]);
    $dressingIngredient->save();

    $complete = $nutrition->forVersion($saladVersion->fresh(), $lines);

    // 200 g of lettuce at 15 kcal/100 g is 30; 30 g of dressing at 480 is 144.
    expect($complete->isComplete())->toBeTrue()
        ->and($complete->unresolved)->toBe([])
        ->and(round((float) $complete->totals['energy']['value'], 4))->toBe(174.0);
});
