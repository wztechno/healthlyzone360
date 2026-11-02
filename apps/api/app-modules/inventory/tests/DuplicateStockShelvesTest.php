<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Services\DuplicateStockShelves;
use Healthy360\Inventory\Services\MealExplosion;
use Healthy360\Inventory\Services\StockItemDerivationService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/*
|--------------------------------------------------------------------------
| One thing on one shelf
|--------------------------------------------------------------------------
|
| The automatic fork left a library ingredient and its copy on two shelves. The
| owner's rule: keep the row with history, add the quantities, audit it, and
| send anything unclear to a review list.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('stock@kitchen.test', ['inventory.view_organisation']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->unit = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->branch = OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'name' => 'Main kitchen',
        'country_code' => 'LB',
        'city' => 'Beirut',
        'timezone' => 'Asia/Beirut',
        'status' => 'active',
        'lock_version' => 0,
    ]);
    $this->duplicates = app(DuplicateStockShelves::class);
    $this->actingAs($this->tenant->user);
});

/**
 * A library ingredient and a kitchen copy, each with a shelf of the same name.
 *
 * @return array{original: StockItem, copy: StockItem}
 */
function shelfPair(object $test, string $copyUnit = 'kg'): array
{
    $library = Ingredient::factory()->create(['organisation_id' => null, 'default_unit_id' => $test->unit->getKey(), 'name_en' => 'Rice']);
    $fork = Ingredient::factory()->create([
        'organisation_id' => $test->orgId,
        'default_unit_id' => $test->unit->getKey(),
        'forked_from_ingredient_id' => $library->getKey(),
        'name_en' => 'Rice',
    ]);

    $shelf = fn (Ingredient $ingredient, string $code, string $unit): StockItem => StockItem::withoutTenancy()->updateOrCreate(
        ['organisation_id' => $test->orgId, 'ingredient_id' => $ingredient->getKey()],
        ['code' => $code, 'name_en' => 'Rice', 'unit_code' => $unit, 'unit_id' => $test->unit->getKey()],
    );

    return ['original' => $shelf($library, 'rice', 'kg'), 'copy' => $shelf($fork, 'rice-2', $copyUnit)];
}

function stocked(object $test, StockItem $shelf, string $quantity): void
{
    StockLevel::withoutTenancy()->create([
        'organisation_id' => $test->orgId,
        'branch_id' => $test->branch->getKey(),
        'stock_item_id' => $shelf->getKey(),
        'quantity' => $quantity,
    ]);

    StockMovement::query()->create([
        'organisation_id' => $test->orgId,
        'branch_id' => $test->branch->getKey(),
        'stock_item_id' => $shelf->getKey(),
        'quantity_delta' => $quantity,
        'reason' => 'receipt',
    ]);
}

it('merges an empty copy into the shelf with history and audits it', function (): void {
    ['original' => $original, 'copy' => $copy] = shelfPair($this);
    stocked($this, $original, '50');

    $found = $this->duplicates->scan($this->orgId);

    expect($found['reviews'])->toBe([])
        ->and($found['merges'])->toHaveCount(1)
        ->and($found['merges'][0]['keep']->getKey())->toBe($original->getKey());

    $this->duplicates->merge($this->orgId, $found['merges'][0]['keep'], $found['merges'][0]['drop']);

    expect(StockItem::withoutTenancy()->whereKey($copy->getKey())->exists())->toBeFalse()
        ->and(AuditLog::query()->where('action', 'inventory.stock_merged')->where('subject_id', $original->getKey())->exists())->toBeTrue();
});

it('keeps whichever side has the history, and adds what the other held', function (): void {
    ['original' => $original, 'copy' => $copy] = shelfPair($this);
    stocked($this, $copy, '7');

    StockLevel::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'branch_id' => $this->branch->getKey(),
        'stock_item_id' => $original->getKey(),
        'quantity' => '2',
    ]);

    $found = $this->duplicates->scan($this->orgId);

    expect($found['merges'][0]['keep']->getKey())->toBe($copy->getKey());

    $this->duplicates->merge($this->orgId, $found['merges'][0]['keep'], $found['merges'][0]['drop']);

    expect((float) StockLevel::withoutTenancy()->where('stock_item_id', $copy->getKey())->sum('quantity'))->toBe(9.0)
        ->and(StockMovement::withoutTenancy()->where('stock_item_id', $copy->getKey())->where('reference_type', 'stock_merge')->sum('quantity_delta'))->toEqual(2);

    // A recipe still on the library row finds the shelf that stayed.
    expect(app(MealExplosion::class)->resolveStockItem($this->orgId, (string) $original->ingredient_id, null)?->getKey())
        ->toBe($copy->getKey());
});

it('lists two shelves that both have history and changes neither', function (): void {
    ['original' => $original, 'copy' => $copy] = shelfPair($this);
    stocked($this, $original, '1');
    stocked($this, $copy, '2');

    $found = $this->duplicates->scan($this->orgId);

    expect($found['merges'])->toBe([])
        ->and($found['reviews'][0]['reason'])->toBe('both_have_history')
        ->and($found['reviews'][0]['shelves'])->toHaveCount(2);
});

it('lists different units for a person', function (): void {
    shelfPair($this, 'bag');

    expect($this->duplicates->scan($this->orgId)['reviews'][0]['reason'])->toBe('different_units');
});

it('lists a same-named shelf that is no copy of the other', function (): void {
    foreach (['Beef fajita', 'beef fajita '] as $index => $name) {
        $ingredient = Ingredient::factory()->create(['organisation_id' => $this->orgId, 'default_unit_id' => $this->unit->getKey(), 'name_en' => "Fajita {$index}"]);

        StockItem::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $this->orgId, 'ingredient_id' => $ingredient->getKey()],
            ['code' => "fajita-{$index}", 'name_en' => $name, 'unit_code' => 'kg', 'unit_id' => $this->unit->getKey()],
        );
    }

    expect($this->duplicates->scan($this->orgId)['reviews'][0]['reason'])->toBe('not_a_copy');
});

it('gives a fork no second shelf, in either order, and a backfill adds none', function (): void {
    ['original' => $original, 'copy' => $copy] = shelfPair($this);
    $found = $this->duplicates->scan($this->orgId);
    $this->duplicates->merge($this->orgId, $found['merges'][0]['keep'], $found['merges'][0]['drop']);

    app(StockItemDerivationService::class)->syncOrganisation($this->orgId);

    expect(StockItem::withoutTenancy()->where('organisation_id', $this->orgId)->where('name_en', 'Rice')->count())->toBe(1);
});

it('clears an empty shelf when its ingredient is archived, and keeps one with stock', function (): void {
    $empty = Ingredient::factory()->create(['organisation_id' => $this->orgId, 'default_unit_id' => $this->unit->getKey()]);
    $held = Ingredient::factory()->create(['organisation_id' => $this->orgId, 'default_unit_id' => $this->unit->getKey()]);
    $heldShelf = StockItem::withoutTenancy()->where('ingredient_id', $held->getKey())->sole();
    stocked($this, $heldShelf, '3');

    foreach ([$empty, $held] as $ingredient) {
        $ingredient->status = IngredientStatus::Archived;
        $ingredient->save();
    }

    expect(StockItem::withoutTenancy()->where('ingredient_id', $empty->getKey())->exists())->toBeFalse()
        ->and(StockItem::withoutTenancy()->whereKey($heldShelf->getKey())->exists())->toBeTrue();
});

it('writes nothing on the default run', function (): void {
    shelfPair($this);

    $this->artisan('kitchen:merge-duplicate-stock', ['--org' => $this->tenant->organisation->slug])
        ->expectsOutputToContain('Dry run')
        ->assertSuccessful();

    expect(StockItem::withoutTenancy()->where('organisation_id', $this->orgId)->where('name_en', 'Rice')->count())->toBe(2);
});

it('serves the review list behind the inventory read', function (): void {
    shelfPair($this, 'bag');

    $this->getJson('/api/v1/catalogue/inventory/duplicates', firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId])
        ->assertOk()
        ->assertJsonPath('data.0.reason', 'different_units');
});
