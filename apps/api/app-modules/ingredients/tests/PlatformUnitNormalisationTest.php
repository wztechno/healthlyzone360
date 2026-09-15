<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The platform library stocks in KG or LTR, and nothing else
|--------------------------------------------------------------------------
|
| The owner's unit table, September 2026. Its reason is narrow and worth stating
| once: nutrition is only ever held per 100 g, so a line has to be weighable, and
| a count has no mass without a per-piece figure nobody has recorded. Fourteen
| ingredients were stocked by the piece with no such figure, so every recipe line
| naming one silently withheld its whole label.
|
| These assert the seed document as it is deployed rather than the generator that
| produces it — `scripts/convert-v6-workbook.py --self-test` covers that, and the
| private workbook it reads is not in this repository. What is checked here is the
| thing a kitchen actually gets.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, KitchenReferenceSeeder::class]);
});

it('stocks every platform ingredient in kilograms or litres', function (): void {
    $offending = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('source_ref', '~', '^ING-[0-9]+$')
        ->join('measurement_units as issued', 'issued.id', '=', 'ingredients.default_unit_id')
        ->whereNotIn('issued.code', ['kg', 'l'])
        ->pluck('ingredients.source_ref')
        ->all();

    expect($offending)->toBe([]);
});

it('buys every platform ingredient in the unit it issues', function (): void {
    /*
     * The owner's table states one value per row — its Type column and its Unit column are the
     * same word on all 306 — so a row bought by the gallon and issued by the litre becomes litres
     * throughout. That matters beyond tidiness: a purchase unit in a different dimension is what
     * `IngredientCostService` refuses, and a supplier order line states the shelf's unit.
     */
    $mismatched = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('source_ref', '~', '^ING-[0-9]+$')
        ->whereNotNull('purchase_unit_id')
        ->whereColumn('purchase_unit_id', '!=', 'default_unit_id')
        ->pluck('source_ref')
        ->all();

    expect($mismatched)->toBe([]);
});

it('weighs every litre-stocked row and no mass-stocked one', function (): void {
    /*
     * `grams_per_unit` is the mass of one of the row's own stock units, so it is exactly the rows
     * stocked by the litre that need one — `RecipeNutritionService::gramsOf()` takes the mass
     * branch for everything else and never reads it.
     *
     * Both directions are asserted. A litre row without a density withholds its label; a mass row
     * carrying one holds a figure nothing reads, which `IngredientCatalogueService` would clear on
     * the next edit anyway.
     */
    $rows = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('source_ref', '~', '^ING-[0-9]+$')
        ->join('measurement_units as issued', 'issued.id', '=', 'ingredients.default_unit_id')
        ->get(['ingredients.source_ref', 'ingredients.grams_per_unit', 'issued.code as unit_code']);

    $litresWithoutDensity = $rows
        ->filter(fn ($row): bool => $row->unit_code === 'l' && $row->grams_per_unit === null)
        ->pluck('source_ref')->values()->all();

    $massWithDensity = $rows
        ->filter(fn ($row): bool => $row->unit_code === 'kg' && $row->grams_per_unit !== null)
        ->pluck('source_ref')->values()->all();

    expect($litresWithoutDensity)->toBe([])
        ->and($massWithDensity)->toBe([]);
});

it('leaves packaging counted, because a cap is not a kilogram', function (): void {
    /*
     * The one place the rule deliberately stops. Packaging carries no nutrition, so the argument
     * for weighing it does not apply — and `recipe_version_packaging` with basis `fills_yield`
     * computes `ceil(yield ÷ capacity)` in whole containers, which is a count by construction.
     */
    $counted = Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('source_ref', '~', '^PKG-[0-9]+$')
        ->join('measurement_units as issued', 'issued.id', '=', 'ingredients.default_unit_id')
        ->where('issued.code', 'piece')
        ->count();

    expect($counted)->toBeGreaterThan(0);
});
