<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\MealExplosion;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Enums\PackagingBasis;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| MealExplosion — the read half of stock consumption
|--------------------------------------------------------------------------
|
| `OrderConsumptionTest` is the regression harness for this arithmetic and stays
| the gate: the extraction that created this class is inert precisely because
| that file did not change. What is pinned *here* is what only becomes visible
| once the explosion can be asked a question without deducting anything.
|
| The load-bearing one is the mixed-unit figure. The grouping order — sum within
| each recipe unit at twelve places, round to six, convert, re-sum — is what
| keeps a forecast agreeing with a deduction on a recipe that measures one
| ingredient two ways. Convert line by line instead and the two figures drift by
| a rounding step per line, on exactly the recipes nobody checks by hand.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('explode@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->organisationId = (string) $this->organisation->getKey();
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisationId,
        'country_code' => $this->organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation((string) $this->tenant->user->getKey(), $this->organisationId);

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->g = MeasurementUnit::query()->where('code', 'g')->sole();
    $this->litre = MeasurementUnit::query()->where('code', 'l')->sole();
    $this->piece = MeasurementUnit::query()->where('code', 'piece')->sole();

    $this->explosion = app(MealExplosion::class);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * An ingredient with exactly the shelves this test wants.
 *
 * Derivation (INV2.0) gives a declared ingredient a shelf the instant it
 * exists, so the derived row is dropped and the named ones created in its
 * place: a test about *which* shelf is chosen cannot leave the candidates to
 * another component's discretion.
 *
 * @param  list<string>  $codes  one stock item per code, all in `$stockUnit`
 * @return array{0: Ingredient, 1: list<StockItem>}
 */
function explodableShelves(object $test, MeasurementUnit $stockUnit, array $codes): array
{
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $test->organisationId,
        'default_unit_id' => (string) $stockUnit->getKey(),
    ]);

    StockItem::withoutTenancy()->where('ingredient_id', (string) $ingredient->getKey())->delete();

    $items = [];

    foreach ($codes as $code) {
        $items[] = StockItem::query()->create([
            'organisation_id' => $test->organisationId,
            'code' => $code,
            'name_en' => 'Shelf '.$code,
            'unit_code' => $stockUnit->code,
            'unit_id' => (string) $stockUnit->getKey(),
            'ingredient_id' => (string) $ingredient->getKey(),
        ]);
    }

    return [$ingredient, $items];
}

/**
 * A published meal whose recipe version carries the given lines. Each line is
 * `[Ingredient, quantity, MeasurementUnit]`.
 *
 * @param  list<array{0: Ingredient, 1: string, 2: MeasurementUnit}>  $lines
 */
function explodableMeal(object $test, ?int $yieldPieceCount, string $wastePercent, array $lines): CatalogueItem
{
    $recipe = Recipe::factory()->create(['organisation_id' => $test->organisationId]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $test->organisationId,
        'yield_piece_count' => $yieldPieceCount,
        'waste_coefficient_percent' => $wastePercent,
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

    $catalogue = Catalogue::factory()->create(['organisation_id' => $test->organisationId]);

    return CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $test->organisationId,
        'recipe_id' => $recipe->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);
}

it('groups a mixed-unit recipe by unit before converting, and lands on the figure computed by hand', function (): void {
    // Flour sits on the shelf in kilograms; the recipe measures it two ways.
    //
    //   grams group : 100 g + 150 g = 250.000000000000, rounded to 250.000000
    //                 → convert to kg → 0.250000
    //   kilos group : 0.5 kg         = 0.500000000000, rounded to 0.500000
    //                 → identity      → 0.500000
    //   re-summed at twelve places    → 0.750000000000  (in the stock unit)
    //
    //   ÷ 4 yield pieces  = 0.187500000000  per sold unit
    //   × 1.125 waste     = 0.210937500000
    //   × 3 meals ordered = 0.632812500000
    //   rounded half away from zero to six places, exactly once → 0.632813
    //
    // Every step above is what makes the figure worth pinning: converting the
    // two lines separately and adding afterwards rounds twice and gives a
    // different answer on a recipe like this one.
    [$flour, $shelves] = explodableShelves($this, $this->kg, ['sku-flour']);

    $meal = explodableMeal($this, yieldPieceCount: 4, wastePercent: '12.50', lines: [
        [$flour, '100', $this->g],
        [$flour, '150', $this->g],
        [$flour, '0.5', $this->kg],
    ]);

    $result = $this->explosion->explode($this->organisationId, $meal, '3', (string) $this->branch->getKey());

    expect($result->failures)->toBe([])
        ->and($result->rows)->toHaveCount(1)
        ->and($result->rows[0])->toBe([
            'stock_item_id' => (string) $shelves[0]->getKey(),
            'stock_unit_id' => (string) $this->kg->getKey(),
            'ingredient_id' => (string) $flour->getKey(),
            'quantity' => '0.632813',
        ]);
});

it('consumes half the ingredients for a half-portion item', function (): void {
    // One sold unit = one yield piece × the item's portion factor. The same
    // recipe, the same version, the same shelf — only the article's declared
    // portion differs, and the deduction has to follow it or a kitchen selling
    // small squares would run its stock down twice as fast on paper as in life.
    //
    //   1 kg ÷ 4 pieces = 0.250000000000  per piece
    //   × 3 meals ordered                 → 0.750000  at factor 1
    //   × 0.5 portion factor              → 0.375000  at factor 0.5
    [$flour, $shelves] = explodableShelves($this, $this->kg, ['sku-flour']);

    $meal = explodableMeal($this, yieldPieceCount: 4, wastePercent: '0.00', lines: [
        [$flour, '1', $this->kg],
    ]);

    // The default first: adding the column moved nothing.
    $whole = $this->explosion->explode($this->organisationId, $meal, '3', (string) $this->branch->getKey());

    expect($whole->failures)->toBe([])
        ->and($whole->rows)->toHaveCount(1)
        ->and($whole->rows[0]['quantity'])->toBe('0.750000');

    $meal->portion_factor = '0.5';
    $meal->save();

    $half = $this->explosion->explode($this->organisationId, $meal, '3', (string) $this->branch->getKey());

    expect($half->failures)->toBe([])
        ->and($half->rows)->toHaveCount(1)
        ->and($half->rows[0])->toBe([
            'stock_item_id' => (string) $shelves[0]->getKey(),
            'stock_unit_id' => (string) $this->kg->getKey(),
            'ingredient_id' => (string) $flour->getKey(),
            'quantity' => '0.375000',
        ]);
});

it('breaks a tie between two shelves for one ingredient on the branch that already holds a level', function (): void {
    // Two shelves for the same ingredient. `aaa-` sorts first by code and would
    // win on ordering alone; `zzz-` is the one this branch actually counts, so
    // it is the one the explosion must deduct from.
    [$flour, $shelves] = explodableShelves($this, $this->kg, ['aaa-flour', 'zzz-flour']);

    StockLevel::withoutTenancy()->create([
        'organisation_id' => $this->organisationId,
        'branch_id' => (string) $this->branch->getKey(),
        'stock_item_id' => (string) $shelves[1]->getKey(),
        'quantity' => '10.0000',
    ]);

    $meal = explodableMeal($this, yieldPieceCount: 1, wastePercent: '0.00', lines: [
        [$flour, '1', $this->kg],
    ]);

    $result = $this->explosion->explode($this->organisationId, $meal, '1', (string) $this->branch->getKey());

    expect($result->rows)->toHaveCount(1)
        ->and($result->rows[0]['stock_item_id'])->toBe((string) $shelves[1]->getKey());

    // With no branch to tie-break against, the deterministic first by code
    // stands rather than an arbitrary one — the explosion still answers.
    $withoutBranch = $this->explosion->explode($this->organisationId, $meal, '1', null);

    expect($withoutBranch->rows[0]['stock_item_id'])->toBe((string) $shelves[0]->getKey());
});

it('surfaces the reason instead of a quantity when a recipe unit will not convert to the stock unit', function (): void {
    // Flour stocked in kilograms (mass), measured in the recipe in litres
    // (volume). There is no density here, so the ingredient is abandoned rather
    // than invented — and it contributes no row at all, never a partial one.
    [$flour, $shelves] = explodableShelves($this, $this->kg, ['sku-flour']);

    $meal = explodableMeal($this, yieldPieceCount: 5, wastePercent: '0.00', lines: [
        [$flour, '1', $this->litre],
    ]);

    $result = $this->explosion->explode($this->organisationId, $meal, '1', (string) $this->branch->getKey());

    expect($result->rows)->toBe([])
        ->and($result->failures)->toHaveCount(1)
        ->and($result->failures[0]['reason_code'])->toBe('unit_conversion_unsupported')
        ->and($result->failures[0]['catalogue_item_id'])->toBe((string) $meal->getKey());
});

/*
|--------------------------------------------------------------------------
| Packaging
|--------------------------------------------------------------------------
|
| A box is an ingredient filed under `packaging-disposables`, so it already has
| a shelf and that shelf is already in the row's own unit. What was missing was
| anybody taking anything off it: nothing in this module read
| `recipe_version_packaging` at all, so a kitchen could sell four hundred
| bottles of sauce and its bottle count never moved.
|
*/

/**
 * Attaches packaging lines to the meal's published version.
 *
 * `quantity` is per *batch* and already carries its `ceil` — `preparePackaging()` computed six
 * bottles for a 1.7 kg yield before the row was stored — so these fixtures state batch figures,
 * exactly as the table does.
 *
 * @param  list<array{0: Ingredient, 1: string, 2: MeasurementUnit}>  $lines
 */
function packagedWith(object $test, CatalogueItem $meal, string $packagingWastePercent, array $lines): void
{
    $version = RecipeVersion::withoutTenancy()
        ->where('recipe_id', (string) $meal->recipe_id)
        ->sole();

    $version->packaging_waste_percent = $packagingWastePercent;
    $version->saveQuietly();

    $lineNumber = 1;
    foreach ($lines as [$item, $quantity, $unit]) {
        RecipeVersionPackaging::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $test->organisationId,
            'line_number' => $lineNumber++,
            'ingredient_id' => (string) $item->getKey(),
            'basis' => PackagingBasis::FillsYield,
            'quantity' => $quantity,
            'unit_id' => (string) $unit->getKey(),
        ]);
    }
}

it('takes the packaging off the shelf alongside the formulation', function (): void {
    [$flour, $flourShelves] = explodableShelves($this, $this->kg, ['sku-flour']);
    [$box, $boxShelves] = explodableShelves($this, $this->piece, ['sku-box']);

    $meal = explodableMeal($this, yieldPieceCount: 12, wastePercent: '0.00', lines: [
        [$flour, '6', $this->kg],
    ]);

    // Twelve boxes for a batch of twelve portions — what `fills_yield` computes
    // when one box holds one portion.
    packagedWith($this, $meal, '0.00', [[$box, '12', $this->piece]]);

    $result = $this->explosion->explode($this->organisationId, $meal, '2', (string) $this->branch->getKey());

    $byShelf = collect($result->rows)->keyBy('stock_item_id');

    expect($result->failures)->toBe([])
        ->and($result->rows)->toHaveCount(2)
        // 6 kg over 12 pieces, times 2 ordered.
        ->and($byShelf->get((string) $flourShelves[0]->getKey())['quantity'])->toBe('1.000000')
        // 12 boxes over 12 pieces, times 2 ordered. One box per portion, which
        // is the figure a person would reach for without any arithmetic at all.
        ->and($byShelf->get((string) $boxShelves[0]->getKey())['quantity'])->toBe('2.000000');
});

it('deducts a fraction of a container when a batch fills fewer than it yields', function (): void {
    [$sauce] = explodableShelves($this, $this->kg, ['sku-sauce']);
    [$bottle, $bottleShelves] = explodableShelves($this, $this->piece, ['sku-bottle']);

    $meal = explodableMeal($this, yieldPieceCount: 12, wastePercent: '0.00', lines: [
        [$sauce, '1.8', $this->kg],
    ]);

    packagedWith($this, $meal, '0.00', [[$bottle, '6', $this->piece]]);

    /*
     * Six bottles across twelve portions is half a bottle a portion, and that is
     * the honest figure rather than a rounding artefact: `stock_levels.quantity`
     * is decimal(14,4), selling the whole batch sums to exactly six, and
     * rounding each sale up to a whole bottle would consume twelve.
     */
    $one = $this->explosion->explode($this->organisationId, $meal, '1', (string) $this->branch->getKey());
    $whole = $this->explosion->explode($this->organisationId, $meal, '12', (string) $this->branch->getKey());

    $bottleOf = fn (object $result): string => collect($result->rows)
        ->firstWhere('stock_item_id', (string) $bottleShelves[0]->getKey())['quantity'];

    expect($bottleOf($one))->toBe('0.500000')
        ->and($bottleOf($whole))->toBe('6.000000');
});

it('applies the packaging waste coefficient, not the production one', function (): void {
    [$flour, $flourShelves] = explodableShelves($this, $this->kg, ['sku-flour']);
    [$label, $labelShelves] = explodableShelves($this, $this->piece, ['sku-label']);

    // Ten per cent process loss, two per cent mis-fed labels. Two columns
    // because they measure different things: sauce left in the pot is not split
    // film, and reusing one coefficient for both would make correcting either
    // silently rewrite the other.
    $meal = explodableMeal($this, yieldPieceCount: 10, wastePercent: '10.00', lines: [
        [$flour, '10', $this->kg],
    ]);

    packagedWith($this, $meal, '2.00', [[$label, '10', $this->piece]]);

    $result = $this->explosion->explode($this->organisationId, $meal, '1', (string) $this->branch->getKey());

    $byShelf = collect($result->rows)->keyBy('stock_item_id');

    // 10 over 10, times 1.10.
    expect($byShelf->get((string) $flourShelves[0]->getKey())['quantity'])->toBe('1.100000')
        // 10 over 10, times 1.02 — the label's own rate, not the flour's.
        ->and($byShelf->get((string) $labelShelves[0]->getKey())['quantity'])->toBe('1.020000');
});

it('explodes exactly as it did before when a version packages nothing', function (): void {
    // The guard on every existing figure in OrderConsumptionTest and
    // RequirementForecastTest: a version with no packaging rows must produce the
    // rows it always produced.
    [$flour, $shelves] = explodableShelves($this, $this->kg, ['sku-flour']);

    $meal = explodableMeal($this, yieldPieceCount: 4, wastePercent: '3.00', lines: [
        [$flour, '2', $this->kg],
    ]);

    $result = $this->explosion->explode($this->organisationId, $meal, '1', (string) $this->branch->getKey());

    expect($result->failures)->toBe([])
        ->and($result->rows)->toHaveCount(1)
        ->and($result->rows[0]['stock_item_id'])->toBe((string) $shelves[0]->getKey())
        ->and($result->rows[0]['quantity'])->toBe('0.515000');
});

it('records a refusal for packaging with no shelf, without abandoning the formulation', function (): void {
    [$flour, $shelves] = explodableShelves($this, $this->kg, ['sku-flour']);

    // A packaging ingredient whose derived shelf has been removed — the state a
    // kitchen reaches by archiving a stock item a live version still names.
    [$box] = explodableShelves($this, $this->piece, []);

    $meal = explodableMeal($this, yieldPieceCount: 2, wastePercent: '0.00', lines: [
        [$flour, '2', $this->kg],
    ]);

    packagedWith($this, $meal, '0.00', [[$box, '2', $this->piece]]);

    $result = $this->explosion->explode($this->organisationId, $meal, '1', (string) $this->branch->getKey());

    // Rows and failures are disjoint per ingredient by construction, so the
    // flour still deducts. A missing box is not a reason to stop taking the
    // flour off the shelf — and `no_stock_item` is blocking, so the order still
    // carries an exception a manager can see and retry.
    expect($result->rows)->toHaveCount(1)
        ->and($result->rows[0]['stock_item_id'])->toBe((string) $shelves[0]->getKey())
        ->and($result->failures)->toHaveCount(1)
        ->and($result->failures[0]['reason_code'])->toBe('no_stock_item');
});
