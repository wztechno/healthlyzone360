<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Organisations\Models\Organisation;

/*
|--------------------------------------------------------------------------
| Allergen mappings — the layered, upgrade-only editor
|--------------------------------------------------------------------------
|
| The one rule everything here exists to protect: a kitchen may say more than
| the platform baseline, never less. Over-declaring an allergen costs a
| customer a menu option; under-declaring one costs them an ambulance.
|
| `catalogueTenant()` and `catalogueHeaders()` come from CatalogueApiTest —
| Pest shares helper functions across the suite, and two definitions of "a
| tenant that can edit the catalogue" would be one too many.
|
*/

beforeEach(function (): void {
    $this->seed();

    $this->a = catalogueTenant('mapper-a@kitchen.test');
    $this->b = catalogueTenant('mapper-b@kitchen.test');

    // A seeded platform ingredient with a real baseline: soya sauce carries
    // both soy and gluten in the source master.
    $this->soyaSauce = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'soya-sauce')->sole();
    $this->url = '/api/v1/catalogue/ingredients/'.$this->soyaSauce->getKey().'/allergens';
});

it('serves the platform baseline to a kitchen that has no overlay', function (): void {
    $this->actingAs($this->a->user);

    $response = $this->getJson($this->url, catalogueHeaders($this->a))->assertOk();

    expect(collect($response->json('data'))->pluck('allergen_code')->sort()->values()->all())
        ->toBe(['gluten', 'soy'])
        ->and(collect($response->json('data'))->pluck('layer')->unique()->all())
        ->toBe(['platform_baseline'])
        ->and(collect($response->json('data'))->pluck('source')->unique()->all())
        ->toBe(['master_list']);
});

it('lets a kitchen add to the baseline without touching it', function (): void {
    $this->actingAs($this->a->user);

    $this->putJson($this->url, [
        'mappings' => [
            ['allergen_code' => 'soy', 'containment' => 'contains'],
            ['allergen_code' => 'gluten', 'containment' => 'contains'],
            ['allergen_code' => 'sesame', 'containment' => 'may_contain', 'source' => 'kitchen_declared', 'evidence' => 'shared production line'],
        ],
    ], catalogueHeaders($this->a))->assertOk();

    $overlay = IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $this->soyaSauce->getKey())
        ->where('organisation_id', $this->a->organisation->getKey())
        ->pluck('allergen_code')
        ->sort()
        ->values()
        ->all();

    $baseline = IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $this->soyaSauce->getKey())
        ->whereNull('organisation_id')
        ->pluck('allergen_code')
        ->sort()
        ->values()
        ->all();

    expect($overlay)->toBe(['gluten', 'sesame', 'soy'])
        ->and($baseline)->toBe(['gluten', 'soy']);
});

it('lets a kitchen strengthen a may_contain into a contains', function (): void {
    $baseline = IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $this->soyaSauce->getKey())
        ->whereNull('organisation_id')
        ->where('allergen_code', 'gluten')
        ->sole();

    $baseline->containment = 'may_contain';
    $baseline->save();

    $this->actingAs($this->a->user);

    $this->putJson($this->url, [
        'mappings' => [
            ['allergen_code' => 'soy', 'containment' => 'contains'],
            ['allergen_code' => 'gluten', 'containment' => 'contains'],
        ],
    ], catalogueHeaders($this->a))->assertOk();

    expect(IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $this->soyaSauce->getKey())
        ->where('organisation_id', $this->a->organisation->getKey())
        ->where('allergen_code', 'gluten')
        ->sole()->containment)->toBe(AllergenContainment::Contains);
});

it('refuses to let a kitchen drop a baseline class', function (): void {
    $this->actingAs($this->a->user);

    $this->putJson($this->url, [
        'mappings' => [['allergen_code' => 'soy', 'containment' => 'contains']],
    ], catalogueHeaders($this->a))
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.weakened_allergen_classes', ['gluten']);

    expect(IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $this->soyaSauce->getKey())
        ->where('organisation_id', $this->a->organisation->getKey())
        ->count())->toBe(0);
});

it('refuses to let a kitchen weaken a baseline contains into a may_contain', function (): void {
    $this->actingAs($this->a->user);

    $this->putJson($this->url, [
        'mappings' => [
            ['allergen_code' => 'soy', 'containment' => 'may_contain'],
            ['allergen_code' => 'gluten', 'containment' => 'contains'],
        ],
    ], catalogueHeaders($this->a))
        ->assertStatus(422)
        ->assertJsonPath('error.details.weakened_allergen_classes', ['soy']);
});

it('refuses to clear a mapping set that a baseline underwrites', function (): void {
    $this->actingAs($this->a->user);

    $this->putJson($this->url, ['mappings' => []], catalogueHeaders($this->a))
        ->assertStatus(422)
        ->assertJsonPath('error.details.weakened_allergen_classes', ['gluten', 'soy']);
});

it('accepts an empty set where there is no baseline to weaken', function (): void {
    $ownRow = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $this->actingAs($this->a->user);

    $url = '/api/v1/catalogue/ingredients/'.$ownRow->getKey().'/allergens';

    $this->putJson($url, [
        'mappings' => [['allergen_code' => 'milk', 'containment' => 'contains']],
    ], catalogueHeaders($this->a))->assertOk();

    // "No allergens" is a statement, not a missing field, so it is honoured.
    $this->putJson($url, ['mappings' => []], catalogueHeaders($this->a))
        ->assertOk()
        ->assertJsonPath('meta.count', 0);

    expect(IngredientAllergen::withoutTenancy()->where('ingredient_id', $ownRow->getKey())->count())->toBe(0);
});

it('replaces rather than merges, per market scope', function (): void {
    $ownRow = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);
    $url = '/api/v1/catalogue/ingredients/'.$ownRow->getKey().'/allergens';

    $this->actingAs($this->a->user);

    $this->putJson($url, [
        'mappings' => [
            ['allergen_code' => 'milk', 'containment' => 'contains'],
            ['allergen_code' => 'egg', 'containment' => 'contains'],
        ],
    ], catalogueHeaders($this->a))->assertOk();

    // A US-only statement is a different set and leaves the "all" set alone.
    $this->putJson($url, [
        'market_scope' => 'us_only',
        'mappings' => [['allergen_code' => 'tree_nut', 'containment' => 'contains']],
    ], catalogueHeaders($this->a))->assertOk();

    // Replacing the "all" set drops egg and keeps the us_only row.
    $this->putJson($url, [
        'mappings' => [['allergen_code' => 'milk', 'containment' => 'contains']],
    ], catalogueHeaders($this->a))->assertOk();

    $rows = IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $ownRow->getKey())
        ->get()
        ->map(fn (IngredientAllergen $row): string => $row->market_scope->value.':'.$row->allergen_code)
        ->sort()
        ->values()
        ->all();

    expect($rows)->toBe(['all:milk', 'us_only:tree_nut']);
});

it('keeps one kitchens overlay invisible to another', function (): void {
    $this->actingAs($this->a->user);

    $this->putJson($this->url, [
        'mappings' => [
            ['allergen_code' => 'soy', 'containment' => 'contains'],
            ['allergen_code' => 'gluten', 'containment' => 'contains'],
            ['allergen_code' => 'sesame', 'containment' => 'may_contain'],
        ],
    ], catalogueHeaders($this->a))->assertOk();

    // actingAs() sets the guard user directly, so no credential swap is
    // needed between the two callers here.
    $this->actingAs($this->b->user);

    $codes = collect($this->getJson($this->url, catalogueHeaders($this->b))->assertOk()->json('data'))
        ->pluck('allergen_code')
        ->sort()
        ->values()
        ->all();

    expect($codes)->toBe(['gluten', 'soy']);
});

it('lets a platform operator replace the baseline itself, not create its own overlay', function (): void {
    // The tenancy auto-fill would otherwise stamp the platform operator's own
    // identifier on a row that is meant to belong to nobody, and the baseline
    // every other kitchen reads would never change.
    $ops = User::query()->where('email', 'ops@healthy360.test')->sole();
    $platform = Organisation::query()->where('slug', 'healthy360-operations')->sole();

    $this->actingAs($ops);

    $this->putJson($this->url, [
        'mappings' => [
            ['allergen_code' => 'soy', 'containment' => 'contains', 'source' => 'master_list'],
            ['allergen_code' => 'gluten', 'containment' => 'contains', 'source' => 'master_list'],
            ['allergen_code' => 'sesame', 'containment' => 'may_contain', 'source' => 'master_list'],
        ],
    ], firstPartyHeaders() + ['X-Organisation-Id' => (string) $platform->getKey()])
        ->assertOk()
        ->assertJsonPath('data.0.layer', 'platform_baseline');

    $rows = IngredientAllergen::withoutTenancy()->where('ingredient_id', $this->soyaSauce->getKey())->get();

    // organisation_id NULL is what makes these rows the baseline every other
    // kitchen inherits, rather than the platform operator's private overlay.
    expect($rows->pluck('organisation_id')->unique()->all())->toBe([null])
        ->and($rows->pluck('allergen_code')->sort()->values()->all())->toBe(['gluten', 'sesame', 'soy']);
});

it('holds a platform operator to no upgrade-only rule, because it writes the baseline', function (): void {
    $ops = User::query()->where('email', 'ops@healthy360.test')->sole();
    $platform = Organisation::query()->where('slug', 'healthy360-operations')->sole();

    $this->actingAs($ops);

    // A correction to the baseline may legitimately remove a class — the rule
    // exists to stop a *tenant* silently dropping a platform warning, not to
    // freeze the platform's own reference data.
    $this->putJson($this->url, [
        'mappings' => [['allergen_code' => 'soy', 'containment' => 'contains', 'source' => 'master_list']],
    ], firstPartyHeaders() + ['X-Organisation-Id' => (string) $platform->getKey()])
        ->assertOk()
        ->assertJsonPath('meta.count', 1);

    expect(IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $this->soyaSauce->getKey())
        ->whereNull('organisation_id')
        ->pluck('allergen_code')
        ->all())->toBe(['soy']);
});

it('rejects a duplicate class inside one submitted set', function (): void {
    $ownRow = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $this->actingAs($this->a->user);

    $this->putJson('/api/v1/catalogue/ingredients/'.$ownRow->getKey().'/allergens', [
        'mappings' => [
            ['allergen_code' => 'milk', 'containment' => 'contains'],
            ['allergen_code' => 'milk', 'containment' => 'may_contain'],
        ],
    ], catalogueHeaders($this->a))
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('audits the mapping change with allergen classes and no redactable key', function (): void {
    $ownRow = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $this->actingAs($this->a->user);

    $this->putJson('/api/v1/catalogue/ingredients/'.$ownRow->getKey().'/allergens', [
        'mappings' => [['allergen_code' => 'milk', 'containment' => 'contains']],
    ], catalogueHeaders($this->a))->assertOk();

    $event = AuditLog::query()->where('action', 'catalogue.ingredient_allergens_updated')->sole();

    expect($event->metadata['allergen_classes'] ?? null)->toBe(['milk'])
        ->and($event->metadata['layer'] ?? null)->toBe('organisation_overlay')
        ->and($event->metadata['market_scope'] ?? null)->toBe('all');

    foreach (array_keys($event->metadata ?? []) as $key) {
        expect(str_ends_with((string) $key, '_code'))->toBeFalse();
    }
});
