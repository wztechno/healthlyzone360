<?php

declare(strict_types=1);

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\ReferenceData\Database\Seeders\MeasurementUnitSeeder;

/*
|--------------------------------------------------------------------------
| Designation resolution
|--------------------------------------------------------------------------
|
| A supplier writes "  OLIVE   Oil ", a technical sheet writes "olive oil",
| and both have to reach the same ingredient — otherwise the importer's
| unresolved-designation report fills with entries that are only different
| whitespace.
|
| Just as important is what normalisation must NOT do. It does not stem, it
| does not strip punctuation and it does not transliterate, because "Paprika
| Sweet" and "Paprika Smoked" are different ingredients with different
| profiles, and a resolver that merged them would attach the wrong allergen
| set to a dish (risk R4).
|
*/

beforeEach(function (): void {
    $this->seed(MeasurementUnitSeeder::class);
});

it('lower-cases, trims and collapses whitespace', function (string $input, string $expected): void {
    expect(IngredientAlias::normalise($input))->toBe($expected);
})->with([
    'plain' => ['olive oil', 'olive oil'],
    'mixed case' => ['Olive Oil', 'olive oil'],
    'leading and trailing space' => ['  Olive Oil  ', 'olive oil'],
    'repeated internal space' => ["Olive\t  Oil", 'olive oil'],
    'newline as whitespace' => ["Olive\nOil", 'olive oil'],
    'arabic is left alone apart from spacing' => ['  زيت   الزيتون ', 'زيت الزيتون'],
]);

it('keeps distinct ingredients distinct', function (): void {
    expect(IngredientAlias::normalise('Paprika Sweet'))
        ->not->toBe(IngredientAlias::normalise('Paprika Smoked'))
        ->and(IngredientAlias::normalise("Chef's Salt"))->toBe("chef's salt");
});

it('writes the normalised form on save without being asked', function (): void {
    $ingredient = Ingredient::factory()->platform()->create();

    $alias = new IngredientAlias;
    $alias->ingredient_id = (string) $ingredient->getKey();
    $alias->alias = '  Extra   VIRGIN Olive Oil ';
    $alias->save();

    expect($alias->alias)->toBe('Extra   VIRGIN Olive Oil')
        ->and($alias->alias_normalised)->toBe('extra virgin olive oil');
});

it('resolves a designation through aliases before names, preferring the tenant row', function (): void {
    $organisation = Organisation::factory()->create();

    $platform = Ingredient::factory()->platform()->create(['name_en' => 'Olive Oil', 'slug' => 'olive-oil']);
    $tenant = Ingredient::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'name_en' => 'House Olive Oil',
        'slug' => 'house-olive-oil',
    ]);

    IngredientAlias::factory()->create(['ingredient_id' => $tenant->getKey(), 'alias' => 'Olive oil']);

    $service = app(IngredientCatalogueService::class);

    // The tenant's alias wins over the platform row's own name: a kitchen
    // that has said "olive oil means ours" means ours.
    expect($service->resolveDesignation('  OLIVE   oil ', (string) $organisation->getKey())?->getKey())
        ->toBe($tenant->getKey())
        // Outside that tenant the same text resolves to the platform row.
        ->and($service->resolveDesignation('Olive Oil', null)?->getKey())->toBe($platform->getKey());
});

it('returns nothing rather than guessing', function (): void {
    Ingredient::factory()->platform()->create(['name_en' => 'Paprika Sweet', 'slug' => 'paprika-sweet']);

    $service = app(IngredientCatalogueService::class);

    expect($service->resolveDesignation('Paprika', null))->toBeNull()
        ->and($service->resolveDesignation('paprika smoked', null))->toBeNull()
        ->and($service->resolveDesignation('   ', null))->toBeNull();
});
