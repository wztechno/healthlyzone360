<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\AllergenDerivation;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Publication, retirement and derived allergens
|--------------------------------------------------------------------------
|
| The gate is deliberately minimal in K1.4 and every reason it can give has a
| test here, because a gate whose refusals are untested is a gate that quietly
| stops refusing. The full readiness evaluator is K1.8; these are the checks
| that can be made honestly with the data this slice holds.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('publisher@catalogue.test');
});

it('publishes a complete product and reports what its label says', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);

    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.item.status', 'published')
        ->assertJsonPath('data.allergens.basis', 'none')
        ->assertHeader('ETag', '"1"');

    expect(AuditLog::query()->where('action', 'catalogue.item_published')->count())->toBe(1);
});

it('refuses to publish an item whose Arabic name is missing', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);
    $item->name_ar = '';
    $item->save();

    $this->actingAs($this->a->user);

    $reasons = $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->json('error.details.reasons');

    expect(collect($reasons)->firstWhere('reason', 'translation_incomplete'))
        ->not->toBeNull()
        ->and(collect($reasons)->firstWhere('reason', 'translation_incomplete')['fields'])->toBe(['name_ar']);

    expect(CatalogueItem::withoutTenancy()->whereKey($item->getKey())->value('status'))->toBe(CatalogueItemStatus::Draft);
});

it('refuses to publish a product with no active variant', function (): void {
    $item = CatalogueItem::factory()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);

    $reasons = $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toContain('no_active_variant');
});

it('refuses to publish a meal with no allergen basis at all', function (): void {
    // Neither a published recipe version nor an ingredient list. The item
    // cannot answer "what is in this", and silence is not a statement of
    // absence.
    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
    ]);

    $this->actingAs($this->a->user);

    $reasons = $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toBe(['no_allergen_basis']);
});

it('accepts an ingredient list as a meals allergen basis', function (): void {
    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
    ]);

    $tahini = CatalogueWorld::mappedIngredient($this->a->organisation, 'Tahini', 'sesame');

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    $this->putJson('/api/v1/catalogue/items/'.$item->getKey().'/ingredients', [
        'ingredients' => [['ingredient_id' => (string) $tahini->getKey(), 'is_representative' => true]],
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], $headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.item.status', 'published')
        ->assertJsonPath('data.allergens.basis', 'item_ingredients')
        ->assertJsonPath('data.allergens.allergens.0.allergen_code', 'sesame');
});

it('refuses to publish a quarantined item structurally', function (): void {
    // `review_required` is a stored quarantine inside the CHECK, not a flag a
    // publish path can forget to read (master plan v2 §4.7).
    $item = CatalogueWorld::publishableProduct($this->a);
    $item->status = 'review_required';
    $item->review_reason = 'Allergen determination contradicts the source.';
    $item->save();

    $this->actingAs($this->a->user);

    $reasons = $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->json('error.details.reasons');

    expect(collect($reasons)->firstWhere('reason', 'item_quarantined')['review_reason'])
        ->toBe('Allergen determination contradicts the source.');
});

it('propagates a linked recipes quarantine to the item that sells it', function (): void {
    // A kitchen with an unresolved allergen contradiction on a formulation may
    // not put the dish on sale while somebody works out whether the burghul
    // contains gluten.
    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $quarantined = RecipeVersion::factory()->quarantined()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'version_number' => 1,
    ]);

    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $recipe->getKey(),
    ]);

    $tahini = CatalogueWorld::mappedIngredient($this->a->organisation, 'Tahini', 'sesame');

    $item->ingredients()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'ingredient_id' => $tahini->getKey(),
        'display_order' => 1,
    ]);

    $this->actingAs($this->a->user);

    $reasons = $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->json('error.details.reasons');

    $reason = collect($reasons)->firstWhere('reason', 'linked_recipe_quarantined');

    expect($reason)->not->toBeNull()
        ->and($reason['recipe_version_ids'])->toBe([(string) $quarantined->getKey()]);
});

it('reports every blocker at once rather than one per attempt', function (): void {
    // A gate that reveals one problem per attempt turns a five-minute fix into
    // five round trips.
    $item = CatalogueItem::factory()->untranslated()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);

    $reasons = $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())
        ->toEqualCanonicalizing(['translation_incomplete', 'no_active_variant']);
});

it('prefers a published recipe versions frozen label over the items own ingredients', function (): void {
    // The version's label was derived at publication from the whole
    // formulation and frozen there; the item's list is a customer-facing
    // summary. A second opinion computed from the weaker source would be a
    // worse answer to a question already answered authoritatively.
    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'version_number' => 1,
    ]);

    RecipeVersionAllergen::withoutTenancy()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'allergen_code' => CatalogueWorld::allergen('gluten')->code,
        'containment' => AllergenContainment::Contains,
        'derivation' => AllergenDerivation::Declared,
        'source_note' => 'Shared fryer.',
    ]);

    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $recipe->getKey(),
    ]);

    $sesame = CatalogueWorld::mappedIngredient($this->a->organisation, 'Tahini', 'sesame');

    $item->ingredients()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'ingredient_id' => $sesame->getKey(),
        'display_order' => 1,
    ]);

    $this->actingAs($this->a->user);

    $this->getJson('/api/v1/catalogue/items/'.$item->getKey().'/allergens', CatalogueWorld::headers($this->a))
        ->assertOk()
        ->assertJsonPath('meta.basis', 'recipe_version')
        ->assertJsonPath('meta.recipe_version_id', (string) $version->getKey())
        ->assertJsonPath('data.allergens.0.allergen_code', 'gluten')
        // A human's statement stays a declaration on the way through: "a chef
        // said so" and "the mappings imply it" are different claims.
        ->assertJsonPath('data.allergens.0.derivation', 'declared');
});

it('takes the strongest containment when two ingredients name one class', function (): void {
    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
    ]);

    $mayContain = CatalogueWorld::mappedIngredient($this->a->organisation, 'Dusted flour', 'gluten', AllergenContainment::MayContain);
    $contains = CatalogueWorld::mappedIngredient($this->a->organisation, 'Burghul', 'gluten', AllergenContainment::Contains);

    foreach ([$mayContain, $contains] as $order => $ingredient) {
        $item->ingredients()->create([
            'organisation_id' => $this->a->organisation->getKey(),
            'ingredient_id' => $ingredient->getKey(),
            'display_order' => $order + 1,
        ]);
    }

    $this->actingAs($this->a->user);

    $response = $this->getJson('/api/v1/catalogue/items/'.$item->getKey().'/allergens', CatalogueWorld::headers($this->a))
        ->assertOk()
        ->assertJsonPath('meta.basis', 'item_ingredients');

    expect($response->json('data.allergens'))->toHaveCount(1)
        ->and($response->json('data.allergens.0.containment'))->toBe('contains')
        // Provenance points at the ingredient that made the stronger claim,
        // not at the first one listed.
        ->and($response->json('data.allergens.0.source_ingredient_id'))->toBe((string) $contains->getKey());
});

it('reports no basis rather than no allergens when nothing has been said', function (): void {
    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);

    $this->getJson('/api/v1/catalogue/items/'.$item->getKey().'/allergens', CatalogueWorld::headers($this->a))
        ->assertOk()
        ->assertJsonPath('meta.basis', 'none')
        ->assertJsonPath('data.allergens', []);
});

it('retires an item from any live state and refuses a second retirement', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], $headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/retire', ['reason' => 'Seasonal line ended.'], $headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.item.status', 'retired')
        ->assertHeader('ETag', '"2"');

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/retire', [], $headers + ['If-Match' => '"2"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    $event = AuditLog::query()->where('action', 'catalogue.item_retired')->sole();

    expect($event->metadata['previous_status'])->toBe('published')
        ->and($event->metadata['reason'])->toBe('Seasonal line ended.');
});

it('retires a draft item, because there is no other way to withdraw one', function (): void {
    // There is no archive action here and no delete anywhere, so refusing to
    // retire a draft would leave a kitchen with no way at all to withdraw a
    // listing it decided against.
    $item = CatalogueItem::factory()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/retire', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.item.status', 'retired');
});

it('refuses to publish an item that is already published', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);
    $item->status = 'published';
    $item->save();

    $this->actingAs($this->a->user);

    $reasons = $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->json('error.details.reasons');

    expect(collect($reasons)->firstWhere('reason', 'item_not_a_draft')['status'])->toBe('published');
});
