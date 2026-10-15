<?php

declare(strict_types=1);

use Healthy360\Allergens\Models\Allergen;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Allergens\AllergenProviderHttp;
use Healthy360\Ingredients\Allergens\AllergenReferenceMapper;
use Healthy360\Ingredients\Allergens\AllergenReferenceService;
use Healthy360\Ingredients\Allergens\LookupFailure;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\SeedDatabaseOnce;
use Tests\Support\NutritionReferenceFixture;

pest()->use(SeedDatabaseOnce::class);

function allergenProduct(array $overrides = []): array
{
    return $overrides + ['code' => '3017620422003', 'product_name' => 'Hazelnut spread', 'brands' => 'Example', 'allergens_tags' => ['en:milk', 'en:nuts'], 'traces_tags' => ['en:eggs'], 'last_modified_t' => 100];
}

function fakeAllergenResponses(array $responses): void
{
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Http::fake($responses);
}

beforeEach(function (): void {
    Cache::flush();
    Http::preventStrayRequests();
    Http::fake([
        'world.openfoodfacts.org/cgi/*' => Http::response(['products' => [allergenProduct()]]),
        'world.openfoodfacts.org/api/v3/*' => Http::response(['product' => allergenProduct()]),
    ]);
});

it('maps only active database classes and keeps contains separate from traces and unknown terms', function (): void {
    $mapped = app(AllergenReferenceMapper::class)->map('open_food_facts', allergenProduct(['allergens_tags' => ['en:wheat', 'en:milk', 'en:unknown'], 'traces_tags' => ['en:milk', 'en:eggs']]));
    expect(array_column($mapped['mappings'], 'allergen_code'))->toBe(['egg', 'gluten', 'milk'])
        ->and($mapped['mappings'][0]['containment'])->toBe('may_contain')
        ->and($mapped['mappings'][2]['containment'])->toBe('contains')
        ->and($mapped['unmapped_terms'])->toBe(['en:unknown']);
    Allergen::query()->where('code', 'milk')->update(['is_active' => false]);
    $mapped = app(AllergenReferenceMapper::class)->map('open_food_facts', allergenProduct());
    expect(array_column($mapped['mappings'], 'allergen_code'))->not->toContain('milk')
        ->and($mapped['unmapped_terms'])->toContain('en:milk');
});

it('uses Open Food Facts without contacting another provider', function (): void {
    $result = app(AllergenReferenceService::class)->search('spread', null);
    expect($result['candidates'])->toHaveCount(1)
        ->and($result['candidates'][0]['selection_token'])->toBeString();
    Http::assertSentCount(1);
});

it('keeps provider failures distinct from successful empty results', function (): void {
    fakeAllergenResponses(['world.openfoodfacts.org/cgi/*' => Http::response([], 503)]);
    $result = app(AllergenReferenceService::class)->search('sauce', null);
    expect($result['candidates'])->toBe([])->and($result['notices'])->toBe(['open_food_facts.unavailable']);
});

it('honours provider cooldown across service instances', function (): void {
    fakeAllergenResponses(['world.openfoodfacts.org/*' => Http::response([], 429, ['Retry-After' => '120'])]);
    expect(fn () => app(AllergenProviderHttp::class)->request('open_food_facts', '/cgi/search.pl', search: true))->toThrow(LookupFailure::class);
    $this->travel(61)->seconds();
    expect(fn () => app(AllergenProviderHttp::class)->request('open_food_facts', '/api/v3/product/3017620422003'))->toThrow(LookupFailure::class);
    Http::assertSentCount(1);
});

it('does not offer empty declarations as an allergen-free import', function (): void {
    $candidate = app(AllergenReferenceMapper::class)->map('open_food_facts', allergenProduct(['allergens_tags' => [], 'traces_tags' => []]));
    expect($candidate['mappings'])->toBe([])->and($candidate['importable'])->toBeFalse();
});

it('maps every canonical Open Food Facts declaration into the existing fourteen classes', function (): void {
    $mapped = app(AllergenReferenceMapper::class)->map('open_food_facts', allergenProduct(['allergens_tags' => array_map(fn (string $code): string => 'en:'.$code, ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts', 'sesame-seeds', 'celery', 'mustard', 'sulphur-dioxide-and-sulphites', 'lupin', 'molluscs'])]));
    expect(array_column($mapped['mappings'], 'allergen_code'))->toBe(Allergen::query()->where('is_active', true)->orderBy('code')->pluck('code')->all());
});

it('binds selections to the authenticated organisation and resolves foreign ingredients before provider requests', function (): void {
    $a = catalogueTenant('lookup-a@kitchen.test');
    $b = catalogueTenant('lookup-b@kitchen.test');
    $this->actingAs($a->user);
    $token = $this->getJson('/api/v1/catalogue/ingredients/allergen-references?q=spread', catalogueHeaders($a))->assertOk()->json('data.candidates.0.selection_token');
    $owned = Ingredient::factory()->create(['organisation_id' => $b->organisation->id]);
    $foreign = Ingredient::factory()->create(['organisation_id' => $a->organisation->id]);
    $this->actingAs($b->user);
    $url = '/api/v1/catalogue/ingredients/'.$owned->id;
    $review = $this->getJson($url, catalogueHeaders($b))->assertOk()->json('data.ingredient.allergen_review_token');
    $body = ['selection_token' => $token, 'review_token' => $review, 'confirmed' => true];
    $this->postJson($url.'/allergens/import-reference', $body, catalogueHeaders($b))->assertStatus(422);
    $this->postJson('/api/v1/catalogue/ingredients/'.$foreign->id.'/allergens/import-reference', $body, catalogueHeaders($b))->assertNotFound();
    Http::assertSentCount(1);
});

it('imports pending suggestions into the tenant layer while preserving the platform baseline', function (): void {
    $tenant = catalogueTenant('lookup@kitchen.test');
    $this->actingAs($tenant->user);
    $headers = catalogueHeaders($tenant);
    $ingredient = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'soya-sauce')->sole();
    $baseline = IngredientAllergen::withoutTenancy()->where('ingredient_id', $ingredient->id)->whereNull('organisation_id')->pluck('allergen_code')->all();
    $url = '/api/v1/catalogue/ingredients/'.$ingredient->id;
    $review = $this->getJson($url, $headers)->assertOk()->json('data.ingredient.allergen_review_token');
    $selection = $this->getJson('/api/v1/catalogue/ingredients/allergen-references?q=spread', $headers)->assertOk()->json('data.candidates.0.selection_token');
    $this->postJson($url.'/allergens/import-reference', ['selection_token' => $selection, 'review_token' => $review, 'confirmed' => true], $headers)->assertOk();
    $rows = IngredientAllergen::withoutTenancy()->where('ingredient_id', $ingredient->id)->where('organisation_id', $tenant->organisation->id)->get();
    expect($rows)->toHaveCount(3)->and($rows->pluck('verification_status')->map(fn ($value) => $value->value)->unique()->all())->toBe(['requires_review'])
        ->and($rows->first()->lookup_source['attribution'])->toBe('Open Food Facts — ODbL')
        ->and(IngredientAllergen::withoutTenancy()->where('ingredient_id', $ingredient->id)->whereNull('organisation_id')->pluck('allergen_code')->all())->toBe($baseline);
    $this->postJson($url.'/allergens/import-reference', ['selection_token' => $selection, 'review_token' => $review, 'confirmed' => true], $headers)->assertStatus(409);
});

it('requires acknowledgement on creation and atomically stores nutrition and pending allergen suggestions', function (): void {
    $tenant = catalogueTenant('lookup-create@kitchen.test');
    $this->actingAs($tenant->user);
    $headers = catalogueHeaders($tenant);
    $token = $this->getJson('/api/v1/catalogue/ingredients/allergen-references?barcode=3017620422003', $headers)->assertOk()->json('data.candidates.0.selection_token');
    $body = NutritionReferenceFixture::selection() + ['name_en' => 'Purchased spread', 'default_unit_id' => gramsId(), 'allergen_reference_token' => $token];
    $this->postJson('/api/v1/catalogue/ingredients', $body, $headers)->assertStatus(422);
    $id = $this->postJson('/api/v1/catalogue/ingredients', $body + ['allergen_reference_confirmed' => true], $headers)->assertCreated()->json('data.ingredient.id');
    $this->getJson('/api/v1/catalogue/ingredients/'.$id, $headers)->assertOk()->assertJsonPath('data.ingredient.allergen_review_required', true)->assertJsonPath('data.ingredient.verification_status', 'unverified');
    expect(IngredientAllergen::withoutTenancy()->where('ingredient_id', $id)->count())->toBe(3);
});

it('rejects changed source details and expired or tampered selections', function (): void {
    $service = app(AllergenReferenceService::class);
    $token = $service->search('spread', null)['candidates'][0]['selection_token'];
    fakeAllergenResponses(['world.openfoodfacts.org/api/v3/*' => Http::response(['product' => allergenProduct(['allergens_tags' => ['en:fish']])])]);
    expect(fn () => $service->resolve($token))->toThrow(ApiException::class, 'changed');
    $this->travel(31)->minutes();
    expect(fn () => $service->resolve($token))->toThrow(ApiException::class, 'Search again');
    expect(fn () => $service->resolve('tampered'))->toThrow(ApiException::class);
});

it('preserves stronger declarations and supplier evidence while imported changes remain pending', function (): void {
    $tenant = catalogueTenant('lookup-preserve@kitchen.test');
    $this->actingAs($tenant->user);
    $headers = catalogueHeaders($tenant);
    $ingredient = Ingredient::factory()->create(['organisation_id' => $tenant->organisation->id, 'verification_status' => 'verified']);
    $url = '/api/v1/catalogue/ingredients/'.$ingredient->id;
    $this->putJson($url.'/allergens', ['mappings' => [
        ['allergen_code' => 'egg', 'containment' => 'contains', 'verification_status' => 'verified', 'evidence' => 'Original egg label'],
        ['allergen_code' => 'milk', 'containment' => 'may_contain', 'source' => 'supplier_declaration', 'verification_status' => 'requires_supplier_confirmation', 'evidence' => 'Supplier sheet'],
        ['allergen_code' => 'celery', 'containment' => 'contains', 'verification_status' => 'requires_supplier_confirmation'],
    ]], $headers)->assertOk();
    $review = $this->getJson($url, $headers)->assertOk()->json('data.ingredient.allergen_review_token');
    $token = $this->getJson('/api/v1/catalogue/ingredients/allergen-references?q=spread', $headers)->assertOk()->json('data.candidates.0.selection_token');
    $this->postJson($url.'/allergens/import-reference', ['selection_token' => $token, 'review_token' => $review, 'confirmed' => true], $headers)->assertOk();
    $rows = IngredientAllergen::withoutTenancy()->where('ingredient_id', $ingredient->id)->get()->keyBy('allergen_code');
    expect($rows)->toHaveCount(4)
        ->and($rows['egg']->containment->value)->toBe('contains')
        ->and($rows['egg']->verification_status->value)->toBe('verified')
        ->and($rows['egg']->evidence)->toBe('Original egg label')
        ->and($rows['milk']->containment->value)->toBe('contains')
        ->and($rows['milk']->verification_status->value)->toBe('requires_supplier_confirmation')
        ->and($rows['milk']->source->value)->toBe('inferred')
        ->and($rows['milk']->lookup_source['previous_determination']['source'])->toBe('supplier_declaration')
        ->and($rows['milk']->evidence)->toBe('Supplier sheet')
        ->and($rows['celery']->verification_status->value)->toBe('requires_supplier_confirmation')
        ->and($ingredient->refresh()->verification_status->value)->toBe('verified')
        ->and($ingredient->allergen_review_required)->toBeTrue();
});

it('rolls back imported mappings and the reminder when the audit write fails', function (): void {
    $tenant = catalogueTenant('lookup-rollback@kitchen.test');
    $this->actingAs($tenant->user);
    $headers = catalogueHeaders($tenant);
    $ingredient = Ingredient::factory()->create(['organisation_id' => $tenant->organisation->id, 'allergen_review_required' => false]);
    $url = '/api/v1/catalogue/ingredients/'.$ingredient->id;
    $review = $this->getJson($url, $headers)->assertOk()->json('data.ingredient.allergen_review_token');
    $token = $this->getJson('/api/v1/catalogue/ingredients/allergen-references?q=spread', $headers)->assertOk()->json('data.candidates.0.selection_token');
    AuditLog::creating(static function ($entry): void {
        if ($entry->action === 'catalogue.ingredient_allergen_reference_imported') {
            throw new RuntimeException('Simulated audit failure');
        }
    });
    $this->postJson($url.'/allergens/import-reference', ['selection_token' => $token, 'review_token' => $review, 'confirmed' => true], $headers)->assertStatus(500);
    expect(IngredientAllergen::withoutTenancy()->where('ingredient_id', $ingredient->id)->count())->toBe(0)
        ->and($ingredient->refresh()->allergen_review_required)->toBeFalse();
});
