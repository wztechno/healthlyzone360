<?php

declare(strict_types=1);

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientCategory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\SeedDatabaseOnce;
use Tests\Support\NutritionReferenceFixture;

/*
|--------------------------------------------------------------------------
| The recipe editor's quick add
|--------------------------------------------------------------------------
|
| `nutrition_pending: true` creates a food row with nobody there to confirm a
| nutrition reference. It lands owing one — `pending_nutrition`, holding the
| assistant's pick as a server-checked suggestion and never as figures — and a
| name the kitchen already sees is refused rather than created twice.
|
| Needs `CatalogueApiTest.php` loaded for `catalogueTenant()`: run both paths
| with `--filter=IngredientQuickAddTest`.
|
*/

pest()->use(SeedDatabaseOnce::class);

beforeEach(function (): void {
    Cache::flush();
    Http::preventStrayRequests();
    $this->selection = NutritionReferenceFixture::selection();
    $this->a = catalogueTenant('quick-a@kitchen.test');
    $this->actingAs($this->a->user);
});

/** @param array<string, mixed> $extra */
function quickAdd(object $tenant, string $name, array $extra = []): TestResponse
{
    return test()->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => $name,
        'default_unit_id' => gramsId(),
        'nutrition_pending' => true,
    ] + $extra, catalogueHeaders($tenant));
}

it('creates a usable, unverified food row owing its reference, with the checked pick as a suggestion', function (): void {
    $created = quickAdd($this->a, 'Quickadd sumac', [
        'name_ar' => 'سماق',
        'nutrition_suggestion' => $this->selection['nutrition_reference'],
        'nutrition_suggestion_hash' => $this->selection['nutrition_reference_hash'],
    ])->assertCreated()
        ->assertJsonPath('data.ingredient.status', 'active')
        ->assertJsonPath('data.ingredient.verification_status', 'unverified')
        ->assertJsonPath('data.ingredient.name_ar', 'سماق')
        // A suggestion, not figures: nothing is saved until the cook confirms a reference.
        ->assertJsonPath('data.ingredient.nutrition_per_100g', null)
        ->assertJsonPath('data.ingredient.nutrition_source', null)
        ->assertJsonPath('data.ingredient.pending_nutrition.suggestion.ref', 'usda:12345')
        ->assertJsonPath('data.ingredient.pending_nutrition.suggestion.source_hash', $this->selection['nutrition_reference_hash']);

    expect(Ingredient::withoutTenancy()->findOrFail($created->json('data.ingredient.id'))->pending_nutrition)->not->toBeNull();
});

it('keeps the row but drops a pick the provider no longer vouches for', function (): void {
    quickAdd($this->a, 'Quickadd mahlab', [
        'nutrition_suggestion' => 'usda:12345',
        'nutrition_suggestion_hash' => str_repeat('0', 64),
    ])->assertCreated()
        ->assertJsonPath('data.ingredient.pending_nutrition', ['suggestion' => null]);

    // And with no pick at all: still owed.
    quickAdd($this->a, 'Quickadd nigella')->assertCreated()
        ->assertJsonPath('data.ingredient.pending_nutrition', ['suggestion' => null]);
});

it('refuses a name the kitchen already sees — English, Arabic or alias — and creates nothing', function (): void {
    $own = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->id, 'name_en' => 'Quickadd zaatar']);
    $platform = Ingredient::factory()->platform()->create(['name_en' => 'Quickadd thyme mix', 'name_ar' => 'quickadd zahtar']);
    $aliased = Ingredient::factory()->platform()->create(['name_en' => 'Quickadd hyssop']);
    IngredientAlias::factory()->create(['ingredient_id' => $aliased->id, 'alias' => 'Quickadd wild thyme']);

    foreach (['Quickadd ZAATAR' => $own, 'quickadd zahtar' => $platform, 'Quickadd wild thyme' => $aliased] as $name => $existing) {
        quickAdd($this->a, $name)
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'resource.conflict')
            ->assertJsonPath('error.details.existing_matches.0.id', (string) $existing->id);
    }

    expect(Ingredient::withoutTenancy()->where('organisation_id', $this->a->organisation->id)->where('name_en', 'ilike', 'quickadd%')->count())->toBe(1);
});

it('refuses packaging, a confirmed reference beside it, and a suggestion without it', function (): void {
    $packagingId = IngredientCategory::withoutTenancy()->where('code', 'packaging-disposables')->sole()->getKey();

    quickAdd($this->a, 'Quickadd box', ['ingredient_category_id' => $packagingId])
        ->assertStatus(422)->assertJsonPath('error.code', 'validation.failed');
    quickAdd($this->a, 'Quickadd both', $this->selection)
        ->assertStatus(422)->assertJsonPath('error.code', 'validation.failed');
    $this->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => 'Quickadd stray',
        'default_unit_id' => gramsId(),
        'nutrition_suggestion' => $this->selection['nutrition_reference'],
        'nutrition_suggestion_hash' => $this->selection['nutrition_reference_hash'],
    ] + $this->selection, catalogueHeaders($this->a))
        ->assertStatus(422)->assertJsonPath('error.code', 'validation.failed');
});

it('stops owing once the cook confirms a reference on the ingredient', function (): void {
    $id = quickAdd($this->a, 'Quickadd urfa')->assertCreated()->json('data.ingredient.id');

    $this->patchJson('/api/v1/catalogue/ingredients/'.$id, $this->selection, catalogueHeaders($this->a) + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.ingredient.pending_nutrition', null)
        ->assertJsonPath('data.ingredient.nutrition_source.ref', 'usda:12345');
});
