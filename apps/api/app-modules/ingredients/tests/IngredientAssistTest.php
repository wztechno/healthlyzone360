<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Ingredients\Assistant\IngredientAssistant;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Organisations\Models\OrganisationMembership;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Laravel\Ai\Prompts\AgentPrompt;
use Tests\SeedDatabaseOnce;
use Tests\Support\NutritionReferenceFixture;

pest()->use(SeedDatabaseOnce::class);

/** @return array<string, mixed> */
function assistAnswer(array $overrides = []): array
{
    return $overrides + [
        'name_ar' => 'حمص',
        'category_code' => 'assist-legume',
        'subcategory_code' => 'assist-legume-dry',
        'possible_duplicates' => [],
        'nutrition_pick' => 0,
        'nutrition_relation' => 'same',
        'nutrition_reason' => 'Plain dry chickpeas.',
        'unit' => 'l',
        'grams_per_unit' => 915,
        'allergen_pick' => 0,
        'allergens' => [['code' => 'milk', 'containment' => 'contains']],
        'allergens_reason' => 'Butter is made from milk.',
    ];
}

/** The Open Food Facts search the allergen picker runs, answering one plain product. */
function fakeAssistAllergenLookup(int $status = 200): void
{
    Http::fake(['world.openfoodfacts.org/*' => $status === 200
        ? Http::response(['products' => [[
            'code' => '3017620422003', 'product_name' => 'Unsalted butter', 'brands' => 'Example',
            'allergens_tags' => ['en:milk'], 'traces_tags' => [], 'last_modified_t' => 100,
        ]]])
        : Http::response([], $status)]);
}

function assist(object $tenant, string $name = 'Chickpeas'): TestResponse
{
    return test()->actingAs($tenant->user)
        ->postJson('/api/v1/catalogue/ingredients/assist', ['name_en' => $name], catalogueHeaders($tenant));
}

beforeEach(function (): void {
    Cache::flush();
    Http::preventStrayRequests();
    NutritionReferenceFixture::selection();
    fakeAssistAllergenLookup();

    $legume = IngredientCategory::factory()->platform()->create(['code' => 'assist-legume', 'name_en' => 'Legume']);
    IngredientCategory::factory()->platform()->create(['code' => 'assist-legume-dry', 'name_en' => 'Dry', 'parent_id' => $legume->id]);
    $other = IngredientCategory::factory()->platform()->create(['code' => 'assist-dairy', 'name_en' => 'Dairy']);
    IngredientCategory::factory()->platform()->create(['code' => 'assist-dairy-cheese', 'name_en' => 'Cheese', 'parent_id' => $other->id]);

    $this->a = catalogueTenant('assist-a@kitchen.test');
    $this->b = catalogueTenant('assist-b@kitchen.test');
});

it('returns the validated suggestion with the picked USDA candidate and its hash', function (): void {
    IngredientAssistant::fake([assistAnswer()])->preventStrayPrompts();

    assist($this->a)->assertOk()
        ->assertJsonPath('data.name_ar', 'حمص')
        ->assertJsonPath('data.category_code', 'assist-legume')
        ->assertJsonPath('data.subcategory_code', 'assist-legume-dry')
        ->assertJsonPath('data.nutrition.pick', 0)
        ->assertJsonPath('data.nutrition.relation', 'same')
        ->assertJsonPath('data.nutrition.candidates.0.ref', 'usda:12345')
        ->assertJsonPath('data.nutrition.candidates.0.source_hash', fn (string $hash): bool => strlen($hash) === 64)
        ->assertJsonPath('data.unit', 'l')
        ->assertJsonPath('data.grams_per_unit', fn (int|float $grams): bool => (float) $grams === 915.0)
        ->assertJsonPath('data.allergens.pick', 0)
        ->assertJsonPath('data.allergens.candidates.0.importable', true)
        ->assertJsonPath('data.allergens.codes', [['code' => 'milk', 'containment' => 'contains']])
        ->assertJsonPath('data.allergens.reason', 'Butter is made from milk.')
        ->assertJsonPath('data.unavailable', []);

    IngredientAssistant::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->prompt === 'Chickpeas'
        && $prompt->provider->name() === 'openai'
        && $prompt->model === 'gpt-5.6-luna');
});

it('reports every exact name, Arabic name and alias match, even with the assistant down', function (): void {
    IngredientAssistant::fake(fn () => throw new RuntimeException('provider down'));
    $own = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->id, 'name_en' => 'Assistpulse']);
    $platform = Ingredient::factory()->platform()->create(['name_en' => 'Assist garbanzo', 'name_ar' => 'assistpulse']);
    $aliased = Ingredient::factory()->platform()->create(['name_en' => 'Assist ceci']);
    IngredientAlias::factory()->create(['ingredient_id' => $aliased->id, 'alias' => 'Assistpulse']);
    Ingredient::factory()->create(['organisation_id' => $this->b->organisation->id, 'name_en' => 'Assistpulse']);

    $response = assist($this->a, 'assistpulse')->assertOk()
        ->assertJsonPath('data.unavailable', ['assistant'])
        ->assertJsonPath('data.name_ar', null)
        ->assertJsonPath('data.nutrition.pick', null)
        ->assertJsonPath('data.nutrition.candidates.0.ref', 'usda:12345')
        // Null, not empty: an empty list would read as "this ingredient has no allergens".
        ->assertJsonPath('data.allergens.codes', null)
        ->assertJsonPath('data.allergens.pick', null)
        ->assertJsonPath('data.unit', null);

    expect(collect($response->json('data.existing_matches'))->pluck('id')->sort()->values()->all())
        ->toBe(collect([$own->id, $platform->id, $aliased->id])->map(fn (mixed $id): string => (string) $id)->sort()->values()->all());
});

it('never offers another kitchen\'s rows, even when the model names every number', function (): void {
    $visible = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->id, 'name_en' => 'Assistpulse beans']);
    $foreign = Ingredient::factory()->create(['organisation_id' => $this->b->organisation->id, 'name_en' => 'Assistpulse other kitchen']);
    IngredientAssistant::fake([assistAnswer(['possible_duplicates' => array_map(
        fn (int $number): array => ['number' => $number, 'reason' => 'Same legume.'],
        range(0, 5000),
    )])]);

    $ids = collect(assist($this->a)->assertOk()->json('data.possible_duplicates'))->pluck('id');

    expect($ids)->toContain((string) $visible->id)->not->toContain((string) $foreign->id)
        ->and($ids->duplicates())->toBeEmpty();
    IngredientAssistant::assertPrompted(fn (AgentPrompt $prompt): bool => str_contains((string) $prompt->agent->instructions(), 'Assistpulse beans')
        && ! str_contains((string) $prompt->agent->instructions(), 'Assistpulse other kitchen'));
});

it('nulls model output that is not on the lists', function (array $answer, array $expected): void {
    IngredientAssistant::fake([assistAnswer($answer)]);

    $data = assist($this->a)->assertOk()->json('data');

    foreach ($expected as $path => $value) {
        expect(data_get($data, $path))->toBe($value);
    }
})->with([
    'hidden finished-goods category' => [['category_code' => 'sauce', 'subcategory_code' => null], ['category_code' => null, 'subcategory_code' => null]],
    'sub-category from another branch' => [['subcategory_code' => 'assist-dairy-cheese'], ['category_code' => 'assist-legume', 'subcategory_code' => null]],
    'sub-category given as the category' => [['category_code' => 'assist-legume-dry', 'subcategory_code' => null], ['category_code' => null]],
    'pick out of range' => [['nutrition_pick' => 7], ['nutrition.pick' => null, 'nutrition.relation' => null, 'nutrition.reason' => null]],
    'latin text as Arabic' => [['name_ar' => 'Chickpeas'], ['name_ar' => null]],
    'a unit the admin does not offer' => [['unit' => 'cup'], ['unit' => null, 'grams_per_unit' => null]],
    'a litre that weighs five grams' => [['grams_per_unit' => 5], ['unit' => 'l', 'grams_per_unit' => null]],
    'a mass for a kilogram' => [['unit' => 'kg', 'grams_per_unit' => 1000], ['unit' => 'kg', 'grams_per_unit' => null]],
    'allergen pick out of range' => [['allergen_pick' => 9], ['allergens.pick' => null]],
    'unknown and repeated allergen codes' => [
        ['allergens' => [
            ['code' => 'milk', 'containment' => 'contains'],
            ['code' => 'unobtainium', 'containment' => 'contains'],
            ['code' => 'milk', 'containment' => 'may_contain'],
        ]],
        ['allergens.codes' => [['code' => 'milk', 'containment' => 'contains']]],
    ],
]);

it('still answers Arabic and category when the USDA lookup fails', function (): void {
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Http::fake(['api.nal.usda.gov/*' => Http::response([], 500)]);
    fakeAssistAllergenLookup();
    IngredientAssistant::fake([assistAnswer(['nutrition_pick' => null, 'nutrition_relation' => null])]);

    assist($this->a)->assertOk()
        ->assertJsonPath('data.unavailable', ['nutrition'])
        ->assertJsonPath('data.nutrition', null)
        ->assertJsonPath('data.name_ar', 'حمص')
        ->assertJsonPath('data.category_code', 'assist-legume');
});

it('still gives the AI allergen read when Open Food Facts is down', function (): void {
    Http::swap(new Factory);
    Http::preventStrayRequests();
    NutritionReferenceFixture::selection();
    fakeAssistAllergenLookup(500);
    IngredientAssistant::fake([assistAnswer(['allergen_pick' => null])]);

    assist($this->a)->assertOk()
        ->assertJsonPath('data.unavailable', ['allergens'])
        ->assertJsonPath('data.allergens.candidates', [])
        ->assertJsonPath('data.allergens.pick', null)
        ->assertJsonPath('data.allergens.codes', [['code' => 'milk', 'containment' => 'contains']])
        ->assertJsonPath('data.unit', 'l');
});

it('refuses a caller who cannot manage the catalogue, and throttles a loop', function (): void {
    IngredientAssistant::fake(fn (): array => assistAnswer());
    // A member with no role: in the organisation, holding no catalogue permission.
    $organisation = catalogueOrganisation();
    $user = User::factory()->create(['email' => 'assist-viewer@kitchen.test']);
    OrganisationMembership::factory()->create(['organisation_id' => $organisation->getKey(), 'user_id' => $user->getKey()]);
    $viewer = (object) compact('organisation', 'user');

    assist($viewer)->assertForbidden();

    foreach (range(1, 20) as $attempt) {
        assist($this->a)->assertOk();
    }
    assist($this->a)->assertStatus(429);
});
