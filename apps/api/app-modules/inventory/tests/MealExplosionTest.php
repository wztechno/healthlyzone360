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
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
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
