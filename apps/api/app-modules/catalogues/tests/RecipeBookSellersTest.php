<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The recipe book, beside what sells each recipe
|--------------------------------------------------------------------------
|
| Every row of GET /catalogue/recipes carries the catalogue items selling the
| recipe (`sold_as`) and what that makes it (`kinds`), and the list filters and
| searches by them. The SQL lives in the catalogues module behind the recipe
| usage port, which is why this suite lives here.
|
| What has to hold: the row, the Kind filter and the strip's counts agree about
| what a recipe is; a kind and a sale status hold of one seller; the keys are
| absent — and the filters refused — for a reader who cannot see the catalogue;
| and no other kitchen's item ever sells, matches or filters a recipe.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('book@sellers.test');
    $this->b = CatalogueWorld::kitchen('elsewhere@sellers.test');
});

/**
 * A recipe with its draft version 1 — the shape `RecipeService::create()` leaves.
 */
function recipeBookRecipe(object $tenant, string $name, ?string $reference = null): Recipe
{
    $recipe = Recipe::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'name_en' => $name,
        'source_ref' => $reference,
    ]);

    RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $tenant->organisation->getKey(),
        'version_number' => 1,
    ]);

    return $recipe;
}

/**
 * @param  array<string, mixed>  $attributes
 */
function recipeBookSeller(object $tenant, Recipe $recipe, CatalogueItemType $type, string $slug, array $attributes = []): CatalogueItem
{
    return CatalogueItem::factory()->create([
        'catalogue_id' => $tenant->catalogue->getKey(),
        'organisation_id' => $tenant->organisation->getKey(),
        'item_type' => $type,
        'slug' => $slug,
        'recipe_id' => $recipe->getKey(),
    ] + $attributes);
}

/**
 * The ids a filtered read of the book returns, sorted so a test compares sets.
 *
 * @param  array<string, string>  $headers
 * @return list<string>
 */
function recipeBookIds(string $query, array $headers): array
{
    $ids = array_column(
        test()->getJson('/api/v1/catalogue/recipes?limit=100&'.$query, $headers)->assertOk()->json('data'),
        'id',
    );

    sort($ids);

    return $ids;
}

/**
 * @param  list<Recipe>  $recipes
 * @return list<string>
 */
function recipeBookIdsOf(array $recipes): array
{
    $ids = array_map(static fn (Recipe $recipe): string => (string) $recipe->getKey(), $recipes);

    sort($ids);

    return $ids;
}

it('lists what sells a recipe in slug order, and every kind it is sold as', function (): void {
    $recipe = recipeBookRecipe($this->a, 'Garlic mayo');

    $sauce = recipeBookSeller($this->a, $recipe, CatalogueItemType::Sauce, 'garlic-mayo', [
        'source_ref' => 'SAC-016',
        'status' => CatalogueItemStatus::Published,
        'image_placeholder_id' => 'sauce-garlic-mayo-photo',
    ]);
    $meal = recipeBookSeller($this->a, $recipe, CatalogueItemType::Meal, 'a-garlic-mayo-plate');

    // A resale product pointing at the recipe is not one of its sellers: a bought-in good does not
    // sell a formulation.
    recipeBookSeller($this->a, $recipe, CatalogueItemType::Product, 'garlic-mayo-jar');

    $this->actingAs($this->a->user);

    $row = $this->getJson('/api/v1/catalogue/recipes', CatalogueWorld::headers($this->a))
        ->assertOk()
        ->json('data.0');

    expect(array_column($row['sold_as'], 'id'))->toBe([(string) $meal->getKey(), (string) $sauce->getKey()])
        // Every seller's kind, once each, in the sellers' own order.
        ->and($row['kinds'])->toBe(['meal', 'sauce'])
        ->and($row['sold_as'][1])->toMatchArray([
            'item_type' => 'sauce',
            'status' => 'published',
            'lock_version' => 0,
            'reference' => 'SAC-016',
            'slug' => 'garlic-mayo',
            'image_placeholder_id' => 'sauce-garlic-mayo-photo',
            'portion_factor' => '1.000',
        ])
        // No stored photograph: the id the storefront derives, so both draw the same picture.
        ->and($row['sold_as'][0]['image_placeholder_id'])->toBe('meal-a-garlic-mayo-plate');
});

it('reads a recipe only a resale product points at as a preparation', function (): void {
    $recipe = recipeBookRecipe($this->a, 'Resold dip');
    recipeBookSeller($this->a, $recipe, CatalogueItemType::Product, 'resold-dip');

    $this->actingAs($this->a->user);

    $this->getJson('/api/v1/catalogue/recipes', CatalogueWorld::headers($this->a))
        ->assertOk()
        ->assertJsonPath('data.0.sold_as', [])
        ->assertJsonPath('data.0.kinds', ['preparation']);
});

it('counts the lines of the version the row is showing, not the live one', function (): void {
    $organisationId = $this->a->organisation->getKey();
    $recipe = Recipe::factory()->create(['organisation_id' => $organisationId]);

    $published = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisationId,
        'version_number' => 1,
    ]);
    $draft = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisationId,
        'version_number' => 2,
    ]);

    $flour = CatalogueWorld::mappedIngredient($this->a->organisation, 'Flour', 'gluten');

    foreach ([[$published, 1], [$published, 2], [$published, 3], [$draft, 1]] as [$version, $lineNumber]) {
        RecipeVersionLine::withoutTenancy()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $organisationId,
            'line_number' => $lineNumber,
            'ingredient_id' => $flour->getKey(),
            'quantity' => '100.0000',
            'unit_id' => CatalogueWorld::unit('g'),
        ]);
    }

    $this->actingAs($this->a->user);

    // The draft is current — it outranks the published version — so the count is its one line,
    // the same version `current_version_status` and the allergen codes describe.
    $this->getJson('/api/v1/catalogue/recipes', CatalogueWorld::headers($this->a))
        ->assertOk()
        ->assertJsonPath('data.0.current_version_status', 'draft')
        ->assertJsonPath('data.0.current_version_line_count', 1);
});

it('serves the book’s own row on the single read and on every write', function (): void {
    $recipe = recipeBookRecipe($this->a, 'Tahini');
    recipeBookSeller($this->a, $recipe, CatalogueItemType::Sauce, 'tahini', ['source_ref' => 'SAC-020']);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);
    $url = '/api/v1/catalogue/recipes/'.$recipe->getKey();

    $listed = $this->getJson('/api/v1/catalogue/recipes', $headers)->assertOk()->json('data.0');

    // The single read used to send `current_version_status: null` and no allergen codes; it is
    // now the same row, field for field.
    expect($this->getJson($url, $headers)->assertOk()->json('data.recipe'))->toBe($listed);

    $updated = $this->patchJson($url, ['name_en' => 'Tahini sauce'], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->json('data.recipe');

    expect(array_keys($updated))->toBe(array_keys($listed))
        ->and($updated['current_version_status'])->toBe('draft')
        ->and($updated['sold_as'])->toBe($listed['sold_as']);

    $created = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Brand new base'], $headers)
        ->assertCreated()
        ->json('data.recipe');

    expect(array_keys($created))->toBe(array_keys($listed))
        ->and($created['current_version_status'])->toBe('draft')
        ->and($created['current_version_line_count'])->toBe(0)
        ->and($created['kinds'])->toBe(['preparation'])
        ->and($created['sold_as'])->toBe([]);

    $archived = $this->postJson('/api/v1/catalogue/recipes/'.$created['id'].'/archive', [], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->json('data.recipe');

    expect(array_keys($archived))->toBe(array_keys($listed));
});

it('leaves the sellers out, and refuses their filters, for a reader who cannot see the catalogue', function (): void {
    $chef = CatalogueWorld::kitchen('chef@sellers.test', ['recipe.view_organisation']);

    $recipe = recipeBookRecipe($chef, 'Toum');
    recipeBookSeller($chef, $recipe, CatalogueItemType::Sauce, 'toum', [
        'source_ref' => 'SAC-001',
        'name_en' => 'House toum',
    ]);

    $this->actingAs($chef->user);
    $headers = CatalogueWorld::headers($chef);

    // Absent, not empty: an empty list would say nothing sells the recipe, which is a fact about
    // the recipe rather than about the reader.
    $row = $this->getJson('/api/v1/catalogue/recipes', $headers)->assertOk()->json('data.0');

    expect($row)->not->toHaveKey('sold_as')
        ->and($row)->not->toHaveKey('kinds')
        ->and($row['current_version_line_count'])->toBe(0);

    expect($this->getJson('/api/v1/catalogue/recipes/'.$recipe->getKey(), $headers)->assertOk()->json('data.recipe'))
        ->not->toHaveKey('sold_as')
        ->not->toHaveKey('kinds');

    foreach (['kind=sauce', 'kind=preparation', 'selling_status=published'] as $filter) {
        $this->getJson('/api/v1/catalogue/recipes?'.$filter, $headers)
            ->assertForbidden()
            ->assertJsonPath('error.code', 'authz.permission_denied')
            ->assertJsonPath('error.details.permission', 'catalogue.view_organisation');
    }

    // And a search never reaches an item the reader cannot see.
    expect(recipeBookIds('query=SAC-001', $headers))->toBe([])
        ->and(recipeBookIds('query=house', $headers))->toBe([])
        ->and(recipeBookIds('query=toum', $headers))->toBe([(string) $recipe->getKey()]);
});

it('files a recipe under every kind it is sold as, and one nothing sells under preparation', function (): void {
    $mixed = recipeBookRecipe($this->a, 'Mixed');
    recipeBookSeller($this->a, $mixed, CatalogueItemType::Meal, 'mixed-plate');
    recipeBookSeller($this->a, $mixed, CatalogueItemType::Sauce, 'mixed-sauce');

    $dressing = recipeBookRecipe($this->a, 'Lemon dressing');
    recipeBookSeller($this->a, $dressing, CatalogueItemType::Dressing, 'lemon-dressing');

    $frozen = recipeBookRecipe($this->a, 'Frozen lasagne');
    recipeBookSeller($this->a, $frozen, CatalogueItemType::FrozenMeal, 'frozen-lasagne');

    // A retired seller still says what the recipe is — the row lists it, so the filter must too.
    $retired = recipeBookRecipe($this->a, 'Old sauce');
    recipeBookSeller($this->a, $retired, CatalogueItemType::Sauce, 'old-sauce', ['status' => CatalogueItemStatus::Retired]);

    $marinade = recipeBookRecipe($this->a, 'Marinade');
    $resold = recipeBookRecipe($this->a, 'Resold');
    recipeBookSeller($this->a, $resold, CatalogueItemType::Product, 'resold-jar');

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    expect(recipeBookIds('kind=meal', $headers))->toBe(recipeBookIdsOf([$mixed]))
        ->and(recipeBookIds('kind=sauce', $headers))->toBe(recipeBookIdsOf([$mixed, $retired]))
        ->and(recipeBookIds('kind=dressing', $headers))->toBe(recipeBookIdsOf([$dressing]))
        ->and(recipeBookIds('kind=frozen_meal', $headers))->toBe(recipeBookIdsOf([$frozen]))
        ->and(recipeBookIds('kind=preparation', $headers))->toBe(recipeBookIdsOf([$marinade, $resold]));

    // A word outside the five is refused, never a filter that quietly matches nothing.
    $this->getJson('/api/v1/catalogue/recipes?kind=product', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid')
        ->assertJsonPath('error.details.parameter', 'kind');
});

it('holds a kind and a sale status of the same seller', function (): void {
    // A draft sauce and a published meal: on sale, and a sauce — but not a sauce on sale.
    $split = recipeBookRecipe($this->a, 'Split');
    recipeBookSeller($this->a, $split, CatalogueItemType::Sauce, 'split-sauce');
    recipeBookSeller($this->a, $split, CatalogueItemType::Meal, 'split-plate', ['status' => CatalogueItemStatus::Published]);

    $live = recipeBookRecipe($this->a, 'Live sauce');
    recipeBookSeller($this->a, $live, CatalogueItemType::Sauce, 'live-sauce', ['status' => CatalogueItemStatus::Published]);

    recipeBookRecipe($this->a, 'Unsold');

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    expect(recipeBookIds('kind=sauce&selling_status=published', $headers))->toBe(recipeBookIdsOf([$live]))
        ->and(recipeBookIds('selling_status=published', $headers))->toBe(recipeBookIdsOf([$split, $live]))
        ->and(recipeBookIds('selling_status=draft', $headers))->toBe(recipeBookIdsOf([$split]))
        // Nothing sells a preparation, so nothing selling one is on sale.
        ->and(recipeBookIds('kind=preparation&selling_status=published', $headers))->toBe([]);

    $this->getJson('/api/v1/catalogue/recipes?selling_status=live', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.details.parameter', 'selling_status');
});

it('counts the filtered book, not the whole of it', function (): void {
    foreach (['Sauce one', 'Sauce two', 'Sauce three'] as $index => $name) {
        recipeBookSeller($this->a, recipeBookRecipe($this->a, $name), CatalogueItemType::Sauce, 'counted-sauce-'.$index);
    }

    recipeBookRecipe($this->a, 'Base one');
    recipeBookRecipe($this->a, 'Base two');

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    // The strip's count per kind is exactly this read: page one of one, reading `total_count`.
    $this->getJson('/api/v1/catalogue/recipes?page=1&per_page=1&kind=sauce', $headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('meta.total_count', 3);

    $this->getJson('/api/v1/catalogue/recipes?page=1&per_page=1&kind=preparation', $headers)
        ->assertOk()
        ->assertJsonPath('meta.total_count', 2);
});

it('finds a recipe by its own handle, its seller’s handle and its seller’s name', function (): void {
    $recipe = recipeBookRecipe($this->a, 'Garlic emulsion', 'RC-0007');
    recipeBookSeller($this->a, $recipe, CatalogueItemType::Sauce, 'house-toum', [
        'source_ref' => 'SAC-016',
        'name_en' => 'House toum',
    ]);

    recipeBookRecipe($this->a, 'Something else', 'RC-0008');

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    foreach (['RC-0007', 'rc-0007', 'SAC-016', 'sac-016', 'House toum', 'TOUM'] as $term) {
        expect(recipeBookIds('query='.urlencode($term), $headers))->toBe([(string) $recipe->getKey()], $term);
    }
});

it('never lets another kitchen’s item sell, match or filter a recipe', function (): void {
    $recipe = recipeBookRecipe($this->a, 'Ours');

    // An item of kitchen B pointing at kitchen A's recipe. The write path would never make one,
    // which is the point: the guard has to be the read's, because `catalogue_items` carries no
    // row-level policy and the seller subqueries bypass the application's scope.
    CatalogueItem::factory()->create([
        'catalogue_id' => $this->b->catalogue->getKey(),
        'organisation_id' => $this->b->organisation->getKey(),
        'item_type' => CatalogueItemType::Sauce,
        'slug' => 'their-sauce',
        'status' => CatalogueItemStatus::Published,
        'source_ref' => 'SAC-999',
        'name_en' => 'Their secret sauce',
        'recipe_id' => $recipe->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    $this->getJson('/api/v1/catalogue/recipes', $headers)
        ->assertOk()
        ->assertJsonPath('data.0.sold_as', [])
        ->assertJsonPath('data.0.kinds', ['preparation']);

    expect(recipeBookIds('kind=sauce', $headers))->toBe([])
        ->and(recipeBookIds('selling_status=published', $headers))->toBe([])
        ->and(recipeBookIds('kind=preparation', $headers))->toBe([(string) $recipe->getKey()])
        ->and(recipeBookIds('query=SAC-999', $headers))->toBe([])
        ->and(recipeBookIds('query=secret', $headers))->toBe([]);
});

it('carries each seller’s channels and default pack', function (): void {
    $organisationId = $this->a->organisation->getKey();
    $recipe = recipeBookRecipe($this->a, 'Harissa');
    $sauce = recipeBookSeller($this->a, $recipe, CatalogueItemType::Sauce, 'harissa');
    recipeBookSeller($this->a, $recipe, CatalogueItemType::Meal, 'harissa-plate');

    $pack = static function (string $code, string $quantity, array $attributes = []) use ($sauce): CatalogueItemVariant {
        $variant = CatalogueItemVariant::factory()->create([
            'catalogue_item_id' => $sauce->getKey(),
            'code' => $code,
        ] + $attributes);

        CatalogueItemPackVariant::factory()->create([
            'catalogue_item_variant_id' => $variant->getKey(),
            'pack_quantity' => $quantity,
            'pack_unit_id' => CatalogueWorld::unit('kg'),
        ]);

        return $variant;
    };

    $small = $pack('jar-250g', '0.2500');
    $large = $pack('jar-500g', '0.5000', ['name_en' => 'Large jar', 'name_ar' => 'جرة كبيرة', 'is_default' => true]);
    // Removed from the item in its editor, which archives rather than deletes: not a pack any more.
    $pack('jar-100g', '0.1000', ['status' => VariantStatus::Archived]);

    $channel = static fn (SalesChannelKind $kind, string $code): SalesChannel => SalesChannel::factory()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'channel_kind' => $kind,
    ]);

    $offer = static fn (SalesChannel $on, array $attributes = []): ChannelCatalogueItem => ChannelCatalogueItem::factory()->create([
        'catalogue_item_id' => $sauce->getKey(),
        'sales_channel_id' => $on->getKey(),
    ] + $attributes);

    $offer($channel(SalesChannelKind::B2cWeb, 'web-shop'));

    // Two packs on one wholesale desk are still one channel.
    $wholesale = $channel(SalesChannelKind::B2b, 'wholesale');
    $offer($wholesale, ['catalogue_item_variant_id' => $small->getKey()]);
    $offer($wholesale, ['catalogue_item_variant_id' => $large->getKey()]);

    // Switched off, out of its window, and a kind with no word in the vocabulary: none of them.
    $offer($channel(SalesChannelKind::Pos, 'desk'), ['is_available' => false]);
    $offer($channel(SalesChannelKind::Marketplace, 'marketplace'), ['available_to' => now()->subDay()->toDateString()]);
    $offer($channel(SalesChannelKind::Insurance, 'insurer'));

    $this->actingAs($this->a->user);

    $sellers = $this->getJson('/api/v1/catalogue/recipes', CatalogueWorld::headers($this->a))
        ->assertOk()
        ->json('data.0.sold_as');

    // Slug order: the sauce, then the plate.
    expect($sellers[0]['id'])->toBe((string) $sauce->getKey())
        ->and($sellers[0]['channel_codes'])->toBe(['b2b', 'b2c'])
        ->and($sellers[0]['pack_count'])->toBe(2)
        // The pack flagged default, not the first by code.
        ->and($sellers[0]['default_pack'])->toBe([
            'label_en' => 'Large jar',
            'label_ar' => 'جرة كبيرة',
            'net_quantity' => '0.5000',
            'net_unit_code' => 'kg',
        ])
        // A meal is sold as itself: no pack, no channel row.
        ->and($sellers[1]['pack_count'])->toBe(0)
        ->and($sellers[1]['default_pack'])->toBeNull()
        ->and($sellers[1]['channel_codes'])->toBe([]);
});
