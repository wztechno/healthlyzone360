<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| kitchen:unit-report — the blast radius, measured before anything moves
|--------------------------------------------------------------------------
|
| The migration that restates deployed ingredients in KG/LTR is gated on one
| fact that is not in the repository: whether a kitchen already holds a cost
| balance in a unit nothing can rebase. `ingredient_stock_costs` has two
| writers, no admin surface and no reset, so a balance stranded there blocks
| every future goods receipt for that ingredient until somebody counts the shelf.
|
| This command is the artefact an operator reads before that migration runs.
| What these check is that it reports the balances that matter, ignores the ones
| that do not, never mistakes a kitchen's own fork for a platform row, and
| changes nothing while it looks.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('unit-report@kitchens.test');
    $this->organisationId = (string) $this->kitchen->organisation->getKey();
});

/**
 * A platform library row, stated in the given unit — the shape the seeder writes.
 */
function platformIngredient(string $ref, string $unitCode): Ingredient
{
    return Ingredient::factory()->create([
        'organisation_id' => null,
        'source_system' => 'healthy360_platform',
        'source_ref' => $ref,
        'default_unit_id' => RecipeWorld::unit($unitCode),
        'purchase_unit_id' => RecipeWorld::unit($unitCode),
    ]);
}

/**
 * The report as a decoded document, so the assertions read the facts rather than console layout.
 *
 * @return array<string, mixed>
 */
function unitReport(): array
{
    Artisan::call('kitchen:unit-report', ['--json' => true]);

    $output = Artisan::output();
    $start = strpos($output, '{');

    return json_decode(substr($output, $start === false ? 0 : $start), true, flags: JSON_THROW_ON_ERROR);
}

it('reports a non-zero balance held in a unit the migration cannot rebase, with its value', function (): void {
    // Tuna, stocked by the can-as-piece, with twelve on the shelf at 1.50 each — the owner's table
    // moves it to kilograms, and there is no per-piece weight anywhere in this system.
    $tuna = platformIngredient('ING-076', 'piece');

    IngredientStockCost::query()->create([
        'organisation_id' => $this->organisationId,
        'ingredient_id' => (string) $tuna->getKey(),
        'unit_id' => RecipeWorld::unit('piece'),
        'quantity_on_hand' => '12',
        'moving_average_cost_amount' => '1.50',
        'currency_code' => 'USD',
    ]);

    $report = unitReport();

    expect($report['stranded_costs'])->toHaveCount(1)
        ->and($report['stranded_costs'][0]['ref'])->toBe('ING-076')
        ->and($report['stranded_costs'][0]['held_unit'])->toBe('piece')
        ->and($report['stranded_costs'][0]['target_unit'])->toBe('kg')
        // The figure that turns "a nuisance" into "a write-off", which is what the owner signs.
        ->and($report['stranded_costs'][0]['value_at_risk'])->toBe('18.000000')
        ->and($report['stranded_costs'][0]['currency'])->toBe('USD');
});

it('does not count an empty shelf as stranded, because there is nothing to carry', function (): void {
    $eggs = platformIngredient('ING-207', 'piece');

    IngredientStockCost::query()->create([
        'organisation_id' => $this->organisationId,
        'ingredient_id' => (string) $eggs->getKey(),
        'unit_id' => RecipeWorld::unit('piece'),
        'quantity_on_hand' => '0',
        'moving_average_cost_amount' => '0.20',
        'currency_code' => 'USD',
    ]);

    $report = unitReport();

    // The ingredient still moves — it is in the list — but no balance is at risk: the next receipt
    // simply adopts the new unit, which `IngredientCostService` does on its own.
    expect(collect($report['moving'])->pluck('ref')->all())->toContain('ING-207')
        ->and($report['stranded_costs'])->toBe([]);
});

it('does not count a balance the migration can convert exactly', function (): void {
    // Held in grams, moving to kilograms. Same dimension, a real ratio, so the balance rebases to
    // the gram and nothing is lost.
    $flour = platformIngredient('ING-008', 'g');

    IngredientStockCost::query()->create([
        'organisation_id' => $this->organisationId,
        'ingredient_id' => (string) $flour->getKey(),
        'unit_id' => RecipeWorld::unit('g'),
        'quantity_on_hand' => '25000',
        'moving_average_cost_amount' => '0.0009',
        'currency_code' => 'USD',
    ]);

    expect(unitReport()['stranded_costs'])->toBe([]);
});

it('never mistakes a kitchen’s own fork for a platform row', function (): void {
    /*
     * The trap this guards. `IngredientCatalogueService::fork()` gives a tenant copy the next `ING-`
     * number in *that organisation's* own sequence, with no source system — so a kitchen can own an
     * "ING-076" that has nothing to do with the platform's tuna. A report keyed on the reference
     * alone would list it, and a migration built from that report would rewrite a kitchen's row.
     */
    Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'source_system' => null,
        'source_ref' => 'ING-076',
        'default_unit_id' => RecipeWorld::unit('piece'),
    ]);

    expect(collect(unitReport()['moving'])->pluck('ref')->all())->not->toContain('ING-076');
});

it('reports nothing to do on a database that already matches the table', function (): void {
    platformIngredient('ING-001', 'kg');
    platformIngredient('ING-012', 'l');

    Artisan::call('kitchen:unit-report');

    expect(Artisan::output())->toContain('already matches the owner unit table');
});

it('changes nothing while it looks', function (): void {
    $tuna = platformIngredient('ING-076', 'piece');

    IngredientStockCost::query()->create([
        'organisation_id' => $this->organisationId,
        'ingredient_id' => (string) $tuna->getKey(),
        'unit_id' => RecipeWorld::unit('piece'),
        'quantity_on_hand' => '12',
        'moving_average_cost_amount' => '1.50',
        'currency_code' => 'USD',
    ]);

    $before = [
        DB::table('ingredients')->where('id', $tuna->getKey())->value('default_unit_id'),
        DB::table('ingredient_stock_costs')->where('ingredient_id', $tuna->getKey())->value('unit_id'),
        DB::table('ingredient_stock_costs')->where('ingredient_id', $tuna->getKey())->value('quantity_on_hand'),
    ];

    unitReport();

    expect([
        DB::table('ingredients')->where('id', $tuna->getKey())->value('default_unit_id'),
        DB::table('ingredient_stock_costs')->where('ingredient_id', $tuna->getKey())->value('unit_id'),
        DB::table('ingredient_stock_costs')->where('ingredient_id', $tuna->getKey())->value('quantity_on_hand'),
    ])->toBe($before);
});
