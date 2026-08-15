<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\StockItemDerivationService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;

/*
|--------------------------------------------------------------------------
| StockItemDerivationService — stock is what you cook with and what you resell
|--------------------------------------------------------------------------
|
| A stock item is no longer declared by hand. It is derived from the ingredient
| library and from the products a kitchen buys in, which is what makes the two
| books on the stock screen possible and what stops a kitchen selling a product
| that deducts nothing.
|
| The rules worth pinning down: what becomes a shelf and what does not, that
| every shelf keeps an ingredient to cost itself by, that a second run changes
| nothing, and that a row pre-dating derivation is adopted rather than orphaned.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('derive@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->organisationId = (string) $this->organisation->getKey();

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->bottle = MeasurementUnit::query()->where('code', 'bottle')->sole();
    $this->piece = MeasurementUnit::query()->where('code', 'piece')->sole();

    $this->catalogue = Catalogue::factory()->create(['organisation_id' => $this->organisationId]);
    $this->derivation = app(StockItemDerivationService::class);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * A product in this kitchen's catalogue, in the given production mode.
 *
 * `$ingredient` is set at creation rather than afterwards on purpose: the
 * observer fires on `created`, so a product that names the ingredient it is has
 * to say so when it is written, exactly as the catalogue writer does.
 */
function product(
    object $test,
    string $nameEn,
    ProductionMode $mode,
    ?MeasurementUnit $purchasingUnit = null,
    ?Ingredient $ingredient = null,
): CatalogueItem {
    return CatalogueItem::factory()->create([
        'organisation_id' => $test->organisationId,
        'catalogue_id' => $test->catalogue->getKey(),
        'item_type' => CatalogueItemType::Product,
        'production_mode' => $mode,
        'name_en' => $nameEn,
        'status' => CatalogueItemStatus::Published,
        'recipe_id' => null,
        'ingredient_id' => $ingredient?->getKey(),
        'purchasing_unit_id' => $purchasingUnit?->getKey(),
    ]);
}

function shelves(object $test): Collection
{
    return StockItem::withoutTenancy()->where('organisation_id', $test->organisationId)->get();
}

it('gives every ingredient the kitchen can see a shelf, its own and the platform library', function (): void {
    $own = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $this->kg->getKey(),
        'name_en' => 'House harissa',
    ]);
    $library = Ingredient::factory()->create([
        'organisation_id' => null,
        'default_unit_id' => (string) $this->kg->getKey(),
        'name_en' => 'Shared saffron',
    ]);

    $this->derivation->syncOrganisation($this->organisationId);

    $byIngredient = shelves($this)->keyBy('ingredient_id');

    expect($byIngredient)->toHaveKey((string) $own->getKey())
        ->and($byIngredient)->toHaveKey((string) $library->getKey())
        ->and($byIngredient[(string) $library->getKey()]->name_en)->toBe('Shared saffron')
        ->and($byIngredient[(string) $library->getKey()]->organisation_id)->toBe($this->organisationId);
});

it('shelves a product it buys in and leaves one it makes to its ingredients', function (): void {
    $bought = product($this, 'Sparkling water 330ml', ProductionMode::Supplier, $this->bottle);
    $alsoBought = product($this, 'Sourdough loaf', ProductionMode::Both);
    $made = product($this, 'House granola', ProductionMode::Production);

    $this->derivation->syncOrganisation($this->organisationId);

    $byCatalogueItem = shelves($this)->whereNotNull('catalogue_item_id')->keyBy('catalogue_item_id');

    expect($byCatalogueItem)->toHaveKey((string) $bought->getKey())
        ->and($byCatalogueItem)->toHaveKey((string) $alsoBought->getKey())
        ->and($byCatalogueItem)->not->toHaveKey((string) $made->getKey())
        // Bought by the bottle, not by the litre a recipe would divide.
        ->and($byCatalogueItem[(string) $bought->getKey()]->unit_code)->toBe('bottle')
        // No purchasing unit named, so a countable piece.
        ->and($byCatalogueItem[(string) $alsoBought->getKey()]->unit_code)->toBe('piece');
});

it('anchors a resold product to an ingredient so its cost has somewhere to live', function (): void {
    $bought = product($this, 'Cold brew can', ProductionMode::Supplier);

    $this->derivation->syncOrganisation($this->organisationId);

    $shelf = shelves($this)->firstWhere('catalogue_item_id', (string) $bought->getKey());

    expect($shelf->ingredient_id)->not->toBeNull()
        ->and($shelf->name_en)->toBe('Cold brew can');

    $anchor = Ingredient::withoutTenancy()->find($shelf->ingredient_id);

    expect($anchor->organisation_id)->toBe($this->organisationId)
        ->and($anchor->name_en)->toBe('Cold brew can');
});

it('reuses the ingredient a product already names rather than minting a second', function (): void {
    $olives = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $this->kg->getKey(),
        'name_en' => 'Olive oil',
    ]);

    $bottled = product($this, 'Olive oil 500ml', ProductionMode::Supplier, $this->bottle, $olives);

    $this->derivation->syncOrganisation($this->organisationId);

    $forOlives = shelves($this)->where('ingredient_id', (string) $olives->getKey());

    // One physical thing, one count: the product adopts the ingredient's shelf
    // instead of standing a second one beside it.
    expect($forOlives)->toHaveCount(1)
        ->and($forOlives->first()->catalogue_item_id)->toBe((string) $bottled->getKey())
        ->and($forOlives->first()->name_en)->toBe('Olive oil 500ml');
});

it('adopts a stock item that pre-dates derivation instead of orphaning it', function (): void {
    // The shape OpsDemoSeeder left behind: a shelf with a real count and no link
    // to anything. It must keep its identity — a kitchen has been adjusting it.
    $legacy = new StockItem;
    $legacy->organisation_id = $this->organisationId;
    $legacy->code = 'basmati-rice';
    $legacy->name_en = 'Basmati rice';
    $legacy->unit_code = 'kg';
    $legacy->unit_id = (string) $this->kg->getKey();
    $legacy->save();

    $this->derivation->syncOrganisation($this->organisationId);

    expect($legacy->refresh()->ingredient_id)->not->toBeNull()
        ->and($legacy->code)->toBe('basmati-rice');
});

it('never re-denominates a shelf that already holds a count', function (): void {
    // Seeded stock is the real case: a shelf written as 40 kg, whose ingredient master measures
    // itself in grams. Refreshing the unit from the source would leave the 40 untouched and turn
    // forty kilograms into forty grams.
    $g = MeasurementUnit::query()->where('code', 'g')->sole();

    $flour = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $g->getKey(),
        'name_en' => 'Flour',
    ]);

    $shelf = StockItem::withoutTenancy()->where('ingredient_id', (string) $flour->getKey())->sole();
    $shelf->unit_code = 'kg';
    $shelf->unit_id = (string) $this->kg->getKey();
    $shelf->save();

    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisationId,
        'country_code' => $this->organisation->country_code,
    ]);

    $level = new StockLevel;
    $level->organisation_id = $this->organisationId;
    $level->branch_id = (string) $branch->getKey();
    $level->stock_item_id = (string) $shelf->getKey();
    $level->quantity = '40';
    $level->save();

    $this->derivation->syncOrganisation($this->organisationId);

    expect($shelf->refresh()->unit_code)->toBe('kg')
        // The name still tracks its source — only the unit is frozen.
        ->and($shelf->name_en)->toBe('Flour');
});

it('corrects the unit of a shelf nothing has ever been counted in', function (): void {
    $g = MeasurementUnit::query()->where('code', 'g')->sole();

    $spice = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $g->getKey(),
        'name_en' => 'Sumac',
    ]);

    $shelf = StockItem::withoutTenancy()->where('ingredient_id', (string) $spice->getKey())->sole();
    $shelf->unit_code = 'kg';
    $shelf->unit_id = (string) $this->kg->getKey();
    $shelf->save();

    $this->derivation->syncOrganisation($this->organisationId);

    // No level and no movement, so there is no quantity to misread.
    expect($shelf->refresh()->unit_code)->toBe('g');
});

it('skips an archived ingredient', function (): void {
    $retired = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $this->kg->getKey(),
        'status' => IngredientStatus::Archived,
    ]);

    // The observer ignores it on creation, and a full sync leaves it alone too.
    $this->derivation->syncOrganisation($this->organisationId);

    expect(shelves($this)->where('ingredient_id', (string) $retired->getKey()))->toHaveCount(0);
});

it('converges on a second run rather than accumulating', function (): void {
    Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $this->kg->getKey(),
    ]);
    product($this, 'Bottled kombucha', ProductionMode::Supplier);

    $this->derivation->syncOrganisation($this->organisationId);
    $afterFirst = shelves($this)->pluck('id')->sort()->values()->all();

    $this->derivation->syncOrganisation($this->organisationId);
    $afterSecond = shelves($this)->pluck('id')->sort()->values()->all();

    expect($afterSecond)->toBe($afterFirst);
});

it('gives a newly declared ingredient a shelf without waiting for a sync', function (): void {
    // The observer's whole point: declare it, then receive against it.
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $this->kg->getKey(),
        'name_en' => 'Za\'atar',
    ]);

    expect(shelves($this)->where('ingredient_id', (string) $ingredient->getKey()))->toHaveCount(1);
});

it('gives a newly added resold product a shelf, and a made one none', function (): void {
    $bought = product($this, 'Bottled lemonade', ProductionMode::Supplier);
    $made = product($this, 'Kitchen focaccia', ProductionMode::Production);

    expect(shelves($this)->where('catalogue_item_id', (string) $bought->getKey()))->toHaveCount(1)
        ->and(shelves($this)->where('catalogue_item_id', (string) $made->getKey()))->toHaveCount(0);
});
