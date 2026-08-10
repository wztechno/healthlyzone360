<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Purchasing form usability (INV1.1) — the three gaps the receipt UX closed
|--------------------------------------------------------------------------
|
| 1. A supplier can be created (manage can, a viewer cannot).
| 2. A receipt priced in the kitchen currency, whose purchase unit differs from
|    the stock item's own, raises the converted quantity and books the cost at
|    the moving average.
| 3. A receiver without the cost permission can still post a quantity-only
|    receipt — the price surface is theirs to skip, not a wall.
|
*/

/**
 * A kitchen whose user holds exactly $permissions, plus a branch to receive into.
 *
 * @param  list<string>  $permissions
 */
function purchasingWorld(string $email, array $permissions): object
{
    $tenant = PricingWorld::kitchen($email, $permissions);
    $organisation = $tenant->organisation;
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'country_code' => $organisation->country_code,
    ]);

    return (object) [
        'tenant' => $tenant,
        'organisation' => $organisation,
        'branch' => $branch,
        'headers' => PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()],
    ];
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

it('creates a supplier for a manager and mints a code when none is given', function (): void {
    $world = purchasingWorld('supplier-writer@kitchen.test', PricingWorld::FULL_PERMISSIONS);

    $this->actingAs($world->tenant->user);

    $response = $this->postJson('/api/v1/catalogue/procurement/suppliers', [
        'name_en' => 'Cedar Wholesale',
        'currency_code' => 'USD',
        'contact_email' => 'orders@cedar.test',
    ], $world->headers);

    $response->assertCreated()
        ->assertJsonPath('data.supplier.name_en', 'Cedar Wholesale')
        ->assertJsonPath('data.supplier.currency_code', 'USD')
        ->assertJsonPath('data.supplier.contact_email', 'orders@cedar.test');

    $supplier = Supplier::withoutTenancy()->sole();
    expect($supplier->code)->not->toBe('')
        ->and($supplier->organisation_id)->toBe((string) $world->organisation->getKey());
});

it('forbids creating a supplier without the manage permission', function (): void {
    $world = purchasingWorld('supplier-reader@kitchen.test', [
        'organisation.view_current',
        'branch.view_current',
        'inventory.view_organisation',
    ]);

    $this->actingAs($world->tenant->user);

    $this->postJson('/api/v1/catalogue/procurement/suppliers', [
        'name_en' => 'Blocked Supplier',
    ], $world->headers)->assertForbidden();

    expect(Supplier::withoutTenancy()->count())->toBe(0);
});

it('posts a priced receipt in a purchase unit, converting the quantity and booking the moving average', function (): void {
    $world = purchasingWorld('receiver@kitchen.test', PricingWorld::FULL_PERMISSIONS);

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), (string) $world->organisation->getKey());

    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $g = MeasurementUnit::query()->where('code', 'g')->sole();

    // The ingredient's cost basis is per kilogram; the stock item is counted in
    // grams — so a purchase quoted in kilograms exercises both conversions.
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $world->organisation->getKey(),
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    $item = StockItem::query()->create([
        'organisation_id' => $world->organisation->getKey(),
        'code' => 'FLR-1',
        'name_en' => 'Flour',
        'unit_code' => 'g',
        'unit_id' => (string) $g->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    app(TenantContext::class)->clear();

    $this->actingAs($world->tenant->user);

    $this->postJson('/api/v1/catalogue/procurement/goods-receipts', [
        'branch_id' => (string) $world->branch->getKey(),
        'lines' => [[
            'stock_item_id' => (string) $item->getKey(),
            'quantity' => 2,
            'unit_id' => (string) $kg->getKey(),
            'unit_price_amount' => 3.0,
            'cost_currency_code' => 'USD',
        ]],
    ], $world->headers)->assertCreated();

    // 2 kg landed, converted into the stock item's grams: 2 kg = 2000 g.
    $level = StockLevel::withoutTenancy()
        ->where('branch_id', (string) $world->branch->getKey())
        ->where('stock_item_id', (string) $item->getKey())
        ->sole();
    expect((string) $level->quantity)->toBe('2000.0000');

    // The cost blends into the ingredient's per-kilogram moving average, in the
    // currency the price was booked in (the kitchen currency).
    $cost = IngredientStockCost::withoutTenancy()->sole();
    expect((string) $cost->moving_average_cost_amount)->toBe('3.000000')
        ->and((string) $cost->quantity_on_hand)->toBe('2.000000')
        ->and($cost->currency_code)->toBe('USD');
});

it('posts a quantity-only receipt for a receiver without the cost permission', function (): void {
    $world = purchasingWorld('countless@kitchen.test', [
        'organisation.view_current',
        'branch.view_current',
        'inventory.view_organisation',
        'inventory.manage_organisation',
    ]);

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), (string) $world->organisation->getKey());

    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $item = StockItem::query()->create([
        'organisation_id' => $world->organisation->getKey(),
        'code' => 'RCE-1',
        'name_en' => 'Rice',
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => null,
    ]);

    app(TenantContext::class)->clear();

    $this->actingAs($world->tenant->user);

    $this->postJson('/api/v1/catalogue/procurement/goods-receipts', [
        'branch_id' => (string) $world->branch->getKey(),
        'lines' => [[
            'stock_item_id' => (string) $item->getKey(),
            'quantity' => 5,
        ]],
    ], $world->headers)->assertCreated();

    $level = StockLevel::withoutTenancy()
        ->where('branch_id', (string) $world->branch->getKey())
        ->where('stock_item_id', (string) $item->getKey())
        ->sole();
    expect((string) $level->quantity)->toBe('5.0000');

    // Quantity-only: nothing was booked to cost.
    expect(IngredientStockCost::withoutTenancy()->count())->toBe(0);
});
