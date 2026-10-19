<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A listing goes on sale only when selling it lowers stock (HA-45)
|--------------------------------------------------------------------------
|
| A confirmed order never refuses on stock math, so a listing that was never set
| up to deduct sells forever and takes nothing off a shelf. The publish gate now
| refuses that setup, the admin item carries it as `stock_blockers` so a listing
| already on sale says what to fix, and `has_recipe=false` finds the imported
| items no recipe sells (HA-44).
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('stock-readiness@catalogue.test');
    $this->headers = CatalogueWorld::headers($this->a);

    $this->actingAs($this->a->user);
});

/** A draft meal cooked when ordered, linked to a recipe whose one version is published. */
function cookedMeal(object $tenant, ?int $piecesProduced): CatalogueItem
{
    $recipe = Recipe::factory()->create(['organisation_id' => $tenant->organisation->getKey()]);

    RecipeVersion::factory()->published()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'recipe_id' => $recipe->getKey(),
        'yield_piece_count' => $piecesProduced,
    ]);

    return CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $tenant->catalogue->getKey(),
        'organisation_id' => $tenant->organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $recipe->getKey(),
    ]);
}

/** A draft frozen meal drawing a shelf counted in `$unitCode`. */
function frozenMealOn(object $tenant, string $unitCode, array $attributes = []): CatalogueItem
{
    $ingredient = CatalogueWorld::producedIngredient($tenant, 'Chicken nuggets', $unitCode);

    return CatalogueItem::factory()->create([
        'catalogue_id' => $tenant->catalogue->getKey(),
        'organisation_id' => $tenant->organisation->getKey(),
        'item_type' => CatalogueItemType::FrozenMeal,
        'name_ar' => 'ناغتس',
        'ingredient_id' => $ingredient->getKey(),
        ...$attributes,
    ]);
}

/** @return list<string> */
function readinessCodes(CatalogueItem $item, array $headers): array
{
    return collect(test()->getJson('/api/v1/catalogue/items/'.$item->getKey().'/readiness', $headers)
        ->assertOk()
        ->json('data.reasons'))->pluck('code')->all();
}

it('refuses a cooked meal whose published recipe states no pieces produced, then publishes it once it does', function (): void {
    $item = cookedMeal($this->a, null);

    $reasons = $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toBe(['stock_no_pieces_produced']);

    RecipeVersion::withoutTenancy()->where('recipe_id', $item->recipe_id)->update(['yield_piece_count' => 4]);

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.item.status', 'published')
        ->assertJsonPath('data.item.stock_blockers', []);
});

it('refuses a cooked meal whose recipe has only a draft', function (): void {
    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    RecipeVersion::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'recipe_id' => $recipe->getKey(),
        'status' => 'draft',
        'yield_piece_count' => 4,
    ]);

    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $recipe->getKey(),
    ]);

    expect(readinessCodes($item, $this->headers))->toContain('stock_recipe_not_published');
});

it('refuses a frozen meal on a weighed shelf until it says how much one sale takes', function (): void {
    $item = frozenMealOn($this->a, 'kg');

    expect(readinessCodes($item, $this->headers))->toBe(['stock_no_amount_per_sale']);

    $item->update(['net_content_quantity' => '0.5000', 'net_content_unit_id' => CatalogueWorld::unit('kg')]);

    expect(readinessCodes($item->refresh(), $this->headers))->toBe([]);
});

it('takes a sized pack as how much one sale of a weighed shelf takes', function (): void {
    $item = frozenMealOn($this->a, 'kg');

    $variant = $item->variants()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'variant_type' => 'pack',
        'code' => 'b2c',
        'is_default' => true,
        'status' => 'active',
        'lock_version' => 0,
    ]);

    $variant->pack()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'pack_quantity' => '0.3000',
        'pack_unit_id' => CatalogueWorld::unit('kg'),
    ]);

    expect(readinessCodes($item, $this->headers))->toBe([]);
});

it('asks nothing more of a frozen meal counted in pieces', function (): void {
    expect(readinessCodes(frozenMealOn($this->a, 'piece'), $this->headers))->toBe([]);
});

it('carries the blockers on a listing already on sale, and lists the items no recipe sells', function (): void {
    $linked = cookedMeal($this->a, null);
    $linked->update(['status' => 'published']);

    $unlinked = CatalogueWorld::publishedMeal($this->a, 'Tiramisu');

    $this->getJson('/api/v1/catalogue/items/'.$linked->getKey(), $this->headers)
        ->assertOk()
        ->assertJsonPath('data.item.stock_blockers', ['stock_no_pieces_produced']);

    $rows = $this->getJson('/api/v1/catalogue/items?item_type=meal&has_recipe=false&page=1&per_page=50', $this->headers)
        ->assertOk()
        ->json('data');

    expect(collect($rows)->pluck('id')->all())->toBe([(string) $unlinked->getKey()])
        ->and($rows[0]['stock_blockers'])->toBe(['stock_no_recipe']);
});
