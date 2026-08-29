<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\Runtime\UnitMap;
use Healthy360\Kitchens\Import\V6\V6CatalogueWriter;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| The v6 recipe technical-sheet importer, end to end
|--------------------------------------------------------------------------
|
| Driven by the synthetic fixtures at `tests/Fixtures/v6/` — three invented
| sheets (a kg sauce, a pieces-with-mass preparation consuming the sauce as
| an intermediate, and a sheet with no yield) plus a fixture dictionary with
| one minted raw material, one item link, one link the supplier-mode guard
| must refuse, and one declined link.
|
| The real formulations are confidential and never in this repository; the
| fixture's job is to exercise every writer decision with invented numbers.
|
*/

const V6_RECIPES_FIXTURE = __DIR__.'/Fixtures/v6/v6-recipes.json';
const V6_RECIPES_DICTIONARY = __DIR__.'/Fixtures/v6/v6-recipe-designations.json';
const V6_CATALOGUE_FIXTURE = __DIR__.'/Fixtures/v6/v6-catalogue.json';

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, KitchenReferenceSeeder::class, OrganisationTypeSeeder::class]);

    UnitMap::forget();

    config()->set('kitchens.import.environments', ['local', 'testing']);
    config()->set('kitchens.import.report_path', 'import-reports-test-'.bin2hex(random_bytes(6)));

    // The catalogue first — the recipes land in the same kitchen and link to
    // its items, exactly the order the real sequence runs in.
    $options = new ImportOptions(
        sourceDirectory: V6_CATALOGUE_FIXTURE,
        organisationSlug: 'test-v6-kitchen',
        dryRun: false,
        validateOnly: false,
    );
    app(V6CatalogueWriter::class)->run($options, new ImportReport($options, 'testing'), V6_CATALOGUE_FIXTURE);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

function runV6RecipesImport(bool $dryRun = false): int
{
    $arguments = [
        '--source' => V6_RECIPES_FIXTURE,
        '--dictionary' => V6_RECIPES_DICTIONARY,
        '--org' => 'test-v6-kitchen',
    ];

    if ($dryRun) {
        $arguments['--dry-run'] = true;
    }

    return test()->artisan('kitchen:import-v6-recipes', $arguments)->run();
}

it('imports every sheet as a draft costed version with verbatim figures', function (): void {
    expect(runV6RecipesImport())->toBe(0);

    $recipes = Recipe::withoutTenancy()->where('source_system', 'healthy360_workbook_v6')->get()->keyBy('slug');

    expect($recipes)->toHaveCount(3)
        ->and($recipes->keys()->sort()->values()->all())
        ->toBe(['fixture-garlic-sauce', 'fixture-no-yield', 'fixture-piece-prep']);

    $versions = RecipeVersion::withoutTenancy()->get()->keyBy(fn (RecipeVersion $v): string => (string) $v->source_ref);

    expect($versions)->toHaveCount(3)
        ->and($versions->pluck('status')->map(fn ($s) => $s->value)->unique()->all())->toBe(['draft'])
        ->and($versions->pluck('completeness')->map(fn ($c) => $c->value)->unique()->all())->toBe(['costed']);

    $sauce = $versions['v6-recipes.json#Sheet1'];
    expect((string) $sauce->yield_quantity)->toBe('1.5000')
        ->and($sauce->yield_piece_count)->toBeNull()
        ->and((string) $sauce->waste_coefficient_percent)->toBe('3.00');

    $lines = RecipeVersionLine::withoutTenancy()
        ->where('recipe_version_id', $sauce->getKey())
        ->orderBy('line_number')
        ->get();

    expect($lines)->toHaveCount(3)
        ->and((string) $lines[0]->unit_cost_amount)->toBe('3.500000')
        ->and((string) $lines[0]->line_cost_amount)->toBe('3.500000')
        ->and($lines[0]->cost_currency_code)->toBe('USD')
        ->and($lines[1]->source_designation)->toBe('Fixture Hot Paste')
        ->and($lines[1]->comment)->toBe('verify supplier');

    // The minted raw material exists exactly once, dictionary-declared.
    $minted = Ingredient::withoutTenancy()->where('slug', 'fixture-hot-paste')->get();
    expect($minted)->toHaveCount(1)
        ->and($minted->first()->source_ref)->toContain('v6-recipe-designations.json#');

    $pieces = $versions['v6-recipes.json#Sheet2'];
    expect($pieces->yield_piece_count)->toBe(130)
        ->and((string) $pieces->yield_quantity)->toBe('7.0000');

    // A sheet claiming both bases with a yield that supports both stores both.
    $snapshot = RecipeCostSnapshot::withoutTenancy()->where('recipe_version_id', $pieces->getKey())->sole();
    expect((string) $snapshot->total_input_cost_amount)->toBe('28.000000')
        ->and((string) $snapshot->cost_per_piece_amount)->toBe('0.215000')
        ->and((string) $snapshot->cost_per_yield_unit_amount)->toBe('4.000000')
        ->and($snapshot->basis_mismatch)->toBeFalse();

    // The no-yield sheet: its per-kg claim has no denominator, so the figure
    // is not stored and the snapshot is flagged.
    $bare = $versions['v6-recipes.json#Sheet3'];
    $bareSnapshot = RecipeCostSnapshot::withoutTenancy()->where('recipe_version_id', $bare->getKey())->sole();
    expect($bareSnapshot->cost_per_yield_unit_amount)->toBeNull()
        ->and($bareSnapshot->basis_mismatch)->toBeTrue();
});

it('links items to their sheets, refuses supplier-mode items, and strips the unlinked flag', function (): void {
    runV6RecipesImport();

    $items = CatalogueItem::withoutTenancy()->get()->keyBy('source_ref');

    $sauceRecipe = Recipe::withoutTenancy()->where('slug', 'fixture-garlic-sauce')->sole();

    expect($items['SAC-901']->recipe_id)->toBe((string) $sauceRecipe->getKey())
        ->and($items['SAC-901']->data_quality_flags)->not->toContain('recipe_library_unlinked')
        // The supplier-mode fries share a dictionary link and must not take it.
        ->and($items['RSL-901']->recipe_id)->toBeNull()
        // The unlinked sauce keeps its honest flag.
        ->and($items['SAC-902']->data_quality_flags)->toContain('recipe_library_unlinked');
});

it('feeds the intermediate chain: the preparation consumes the sauce the other sheet produces', function (): void {
    runV6RecipesImport();

    $sauceItem = CatalogueItem::withoutTenancy()->where('source_ref', 'SAC-901')->sole();
    $sauceVersion = RecipeVersion::withoutTenancy()->where('source_ref', 'v6-recipes.json#Sheet1')->sole();

    // The sauce sheet's output is the same ingredient its catalogue item is.
    $output = RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $sauceVersion->getKey())->sole();
    expect($output->ingredient_id)->toBe($sauceItem->ingredient_id)
        ->and($output->is_primary)->toBeTrue();

    // And the preparation's second line names exactly that ingredient.
    $prepVersion = RecipeVersion::withoutTenancy()->where('source_ref', 'v6-recipes.json#Sheet2')->sole();
    $intermediateLine = RecipeVersionLine::withoutTenancy()
        ->where('recipe_version_id', $prepVersion->getKey())
        ->where('line_number', 2)
        ->sole();

    expect($intermediateLine->ingredient_id)->toBe($sauceItem->ingredient_id);
});

it('changes nothing on a second run and writes nothing on a dry run', function (): void {
    runV6RecipesImport();

    $counts = fn (): array => [
        Recipe::withoutTenancy()->count(),
        RecipeVersion::withoutTenancy()->count(),
        RecipeVersionLine::withoutTenancy()->count(),
        RecipeVersionOutput::withoutTenancy()->count(),
        RecipeCostSnapshot::withoutTenancy()->count(),
        Ingredient::withoutTenancy()->count(),
    ];

    $before = $counts();
    runV6RecipesImport();
    expect($counts())->toBe($before);

    // Dry run on a fresh org state: roll back everything, including the world.
    RecipeVersion::withoutTenancy()->get()->each->delete();
    Recipe::withoutTenancy()->get()->each->delete();

    runV6RecipesImport(dryRun: true);
    expect(Recipe::withoutTenancy()->count())->toBe(0);
});
