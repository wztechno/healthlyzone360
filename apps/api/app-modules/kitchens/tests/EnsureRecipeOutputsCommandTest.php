<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Services\WeeklyLineCost;
use Healthy360\Recipes\Services\WeeklyRecipeCostingService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| kitchen:ensure-recipe-outputs
|--------------------------------------------------------------------------
|
| What existed before the server wrote outputs by itself: a sauce whose draft
| states no output, a sauce published without one (and so never costable as a
| component), and a preparation with no twin at all. The command gives each
| what the editor now writes, a dry run writes nothing, and a second run is a
| no-op.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    config()->set('kitchens.import.environments', ['local', 'testing']);

    // The test queue is `sync`: claiming a twin queues its dependants' recompute.
    Queue::fake();

    $this->kitchen = RecipeWorld::kitchen('ensure-outputs@kitchens.test');
    $this->orgId = (string) $this->kitchen->organisation->getKey();
    $this->kilograms = RecipeWorld::unit('kg');
    $catalogue = Catalogue::factory()->create(['organisation_id' => $this->orgId]);

    $oil = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Olive oil');
    $oil->default_unit_id = $this->kilograms;
    $oil->purchase_unit_id = null;
    $oil->purchase_price_amount = '10.000000';
    $oil->purchase_price_currency = 'USD';
    $oil->save();

    /** A recipe whose one version makes 4 kg from 2 kg of oil, sold as a sauce when a twin is given. */
    $make = function (string $name, string $status, ?Ingredient $twin) use ($catalogue, $oil): RecipeVersion {
        $recipe = Recipe::factory()->create(['organisation_id' => $this->orgId, 'name_en' => $name]);

        $version = RecipeVersion::factory()->create([
            'recipe_id' => $recipe->getKey(),
            'organisation_id' => $this->orgId,
            'status' => $status,
            'yield_quantity' => '4',
            'yield_unit_id' => $this->kilograms,
            'waste_coefficient_percent' => '0',
        ]);

        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $this->orgId,
            'ingredient_id' => $oil->getKey(),
            'line_number' => 1,
            'quantity' => '2',
            'unit_id' => $this->kilograms,
        ]);

        if ($twin !== null) {
            CatalogueItem::factory()->sauce()->create([
                'catalogue_id' => $catalogue->getKey(),
                'organisation_id' => $this->orgId,
                'recipe_id' => $recipe->getKey(),
                'ingredient_id' => $twin->getKey(),
            ]);
        }

        return $version;
    };

    $twin = function (string $name): Ingredient {
        $ingredient = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, $name);
        $ingredient->default_unit_id = $this->kilograms;
        $ingredient->purchase_price_amount = null;
        $ingredient->purchase_price_currency = null;
        $ingredient->save();

        return $ingredient;
    };

    $this->draftTwin = $twin('Garlic sauce');
    $this->publishedTwin = $twin('Tahini sauce');

    $this->draftSauce = $make('Garlic sauce', 'draft', $this->draftTwin);
    $this->publishedSauce = $make('Tahini sauce', 'published', $this->publishedTwin);
    $this->preparation = $make('Onion base', 'draft', null);

    $this->run = fn (bool $dryRun = false) => $this->artisan('kitchen:ensure-recipe-outputs', ['--org' => $this->kitchen->organisation->slug] + ($dryRun ? ['--dry-run' => true] : []));
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

it('writes nothing on a dry run, and says what it would do', function (): void {
    $ingredients = Ingredient::withoutTenancy()->count();

    ($this->run)(dryRun: true)
        ->expectsOutputToContain('needs a twin')
        ->expectsOutputToContain('Dry run: 1 twin(s) would be created, 3 output row(s) would be written')
        ->assertSuccessful();

    expect(RecipeVersionOutput::withoutTenancy()->count())->toBe(0)
        ->and(Ingredient::withoutTenancy()->count())->toBe($ingredients)
        ->and(Recipe::withoutTenancy()->whereNotNull('twin_ingredient_id')->count())->toBe(0);
});

it('states the yield on a draft and a published version, gives an old preparation a twin, and repeats as a no-op', function (): void {
    ($this->run)()->assertSuccessful();

    $outputOf = fn (RecipeVersion $version): RecipeVersionOutput => RecipeVersionOutput::withoutTenancy()
        ->where('recipe_version_id', $version->getKey())
        ->sole();

    expect($outputOf($this->draftSauce))
        ->ingredient_id->toBe((string) $this->draftTwin->getKey())
        ->output_quantity->toBe('4.0000')
        ->follows_yield->toBeTrue();

    expect($outputOf($this->publishedSauce))
        ->ingredient_id->toBe((string) $this->publishedTwin->getKey())
        ->is_primary->toBeTrue();

    // The old preparation has a twin of its own now, and its draft makes it.
    $preparationTwin = Recipe::withoutTenancy()->whereKey($this->preparation->recipe_id)->value('twin_ingredient_id');

    expect($preparationTwin)->not->toBeNull()
        ->and($outputOf($this->preparation)->ingredient_id)->toBe($preparationTwin);

    // The published sauce is claimed as publication claims it, so a meal's line is costed from it:
    // 2 kg of oil at 10.00 makes 4 kg — 5.00 a kilo.
    expect($this->publishedTwin->refresh()->nutrition_derived_from_version_id)->toBe((string) $this->publishedSauce->getKey());

    app(TenantContext::class)->setOrganisation((string) $this->kitchen->user->getKey(), $this->orgId);
    app(DatabaseTenantContext::class)->apply(null, $this->orgId, null);

    $cost = app(WeeklyRecipeCostingService::class)->unitCostsFor($this->orgId, [(string) $this->publishedTwin->getKey() => $this->kilograms]);

    expect($cost[(string) $this->publishedTwin->getKey()])
        ->source->toBe(WeeklyLineCost::SOURCE_COMPONENT)
        ->unitCostAmount->toBe('5.000000');

    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();

    // Every twin linked, every row written: a second run has nothing to do.
    $ingredients = Ingredient::withoutTenancy()->count();

    ($this->run)()
        ->expectsOutputToContain('0 twin(s) created, 0 output row(s) written')
        ->assertSuccessful();

    expect(RecipeVersionOutput::withoutTenancy()->count())->toBe(3)
        ->and(Ingredient::withoutTenancy()->count())->toBe($ingredients);
});

it('never touches a version that already states what it produces', function (): void {
    RecipeVersionOutput::withoutTenancy()->create([
        'recipe_version_id' => $this->draftSauce->getKey(),
        'organisation_id' => $this->orgId,
        'ingredient_id' => $this->draftTwin->getKey(),
        'output_quantity' => '3',
        'unit_id' => $this->kilograms,
        'is_primary' => true,
    ]);

    ($this->run)()->assertSuccessful();

    expect(RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $this->draftSauce->getKey())->sole())
        ->output_quantity->toBe('3.0000')
        ->follows_yield->toBeFalse();
});
