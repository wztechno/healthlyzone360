<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\CatalogueIngredientUsageRegistry;
use Healthy360\Catalogues\Services\CatalogueRecipeUsageRegistry;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| What the catalogue holds on to
|--------------------------------------------------------------------------
|
| Two ports, one composed and one replaced. An ingredient a live listing names
| cannot be archived; a published recipe version a live listing sells cannot
| be retired. Both refusals are `catalogue.in_use`, both name what is holding
| the row, and both disappear once the listing is retired.
|
| The composition is the part worth testing hardest: the catalogue module
| *decorates* the recipes module's ingredient registry, and a decorator that
| accidentally replaced it would silently make an ingredient used by a live
| formulation archivable again — a K1.2 regression nobody would notice until a
| published recipe pointed at history.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('dependencies@catalogue.test');
});

it('composes both usage registries rather than replacing one with the other', function (): void {
    // The container-level proof. Both modules answer, and the answer that
    // arrives at the ingredients module carries both halves.
    $registry = app(IngredientUsageRegistry::class);

    expect($registry)->toBeInstanceOf(CatalogueIngredientUsageRegistry::class)
        ->and(app(RecipeUsageRegistry::class))
        ->toBeInstanceOf(CatalogueRecipeUsageRegistry::class);
});

it('refuses to archive an ingredient a live listing names', function (): void {
    $tahini = CatalogueWorld::mappedIngredient($this->a->organisation, 'Tahini', 'sesame');

    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
    ]);

    $item->ingredients()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'ingredient_id' => $tahini->getKey(),
        'display_order' => 1,
    ]);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    $this->postJson('/api/v1/catalogue/ingredients/'.$tahini->getKey().'/archive', [], $headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.in_use')
        ->assertJsonPath('error.details.catalogue_item_ids', [(string) $item->getKey()])
        // The recipes module's half is still reported, empty, rather than
        // missing: a shape that changed depending on which module answered
        // would be a client bug waiting to happen.
        ->assertJsonPath('error.details.recipe_version_ids', []);

    // Retiring the listing releases the hold. History may point at an
    // archived ingredient — that is what history is.
    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/retire', [], $headers + ['If-Match' => '"0"'])
        ->assertOk();

    $this->postJson('/api/v1/catalogue/ingredients/'.$tahini->getKey().'/archive', [], $headers + ['If-Match' => '"0"'])
        ->assertOk();

    expect(Ingredient::withoutTenancy()->whereKey($tahini->getKey())->value('status'))
        ->toBe(IngredientStatus::Archived);
});

it('still refuses to archive an ingredient a live formulation names', function (): void {
    // The K1.2 rule, re-asserted through the decorated registry. This is the
    // regression the composition exists to prevent.
    $flour = CatalogueWorld::mappedIngredient($this->a->organisation, 'Flour', 'gluten');

    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'version_number' => 1,
    ]);

    RecipeVersionLine::withoutTenancy()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'line_number' => 1,
        'ingredient_id' => $flour->getKey(),
        'quantity' => '100.0000',
        'unit_id' => CatalogueWorld::unit('g'),
    ]);

    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/ingredients/'.$flour->getKey().'/archive', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.in_use')
        ->assertJsonPath('error.details.recipe_version_ids', [(string) $version->getKey()])
        ->assertJsonPath('error.details.catalogue_item_ids', []);
});

it('refuses to retire a published version a published listing sells', function (): void {
    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'version_number' => 1,
    ]);

    $item = CatalogueItem::factory()->meal()->published()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $recipe->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);
    $retireVersion = '/api/v1/catalogue/recipes/'.$recipe->getKey().'/versions/'.$version->getKey().'/retire';

    $this->postJson($retireVersion, [], $headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.in_use')
        ->assertJsonPath('error.details.catalogue_item_ids', [(string) $item->getKey()]);

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/retire', [], $headers + ['If-Match' => '"0"'])
        ->assertOk();

    $this->postJson($retireVersion, [], $headers + ['If-Match' => '"0"'])->assertOk();
});

it('lets a draft listing keep a recipe version retirable', function (): void {
    // A draft item is somebody working on next months menu. Blocking a
    // retirement on it would make drafting a future dish an obstacle to
    // withdrawing a current one.
    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'version_number' => 1,
    ]);

    CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'recipe_id' => $recipe->getKey(),
    ]);

    $this->actingAs($this->a->user);

    $this->postJson(
        '/api/v1/catalogue/recipes/'.$recipe->getKey().'/versions/'.$version->getKey().'/retire',
        [],
        CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'],
    )->assertOk();
});
