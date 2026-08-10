<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);
    $this->tenant = PricingWorld::kitchen('inventory@kitchen.test');
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant) + [
        'X-Branch-Id' => (string) $this->branch->getKey(),
    ];
});

it('lists stock levels enriched with the item code, name and ingredient, and records an adjustment', function (): void {
    $item = StockItem::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'code' => 'rice-01',
        'name_en' => 'Rice',
        'unit_code' => 'kg',
    ]);

    $this->postJson('/api/v1/catalogue/inventory/adjustments', [
        'branch_id' => (string) $this->branch->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'quantity_delta' => 10,
    ], $this->headers)->assertCreated();

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $item->getKey())->value('quantity'))->toBe('10.0000');

    $this->getJson('/api/v1/catalogue/inventory/levels', $this->headers)->assertOk()
        ->assertJsonFragment([
            'stock_item_id' => (string) $item->getKey(),
            'item_code' => 'rice-01',
            'item_name_en' => 'Rice',
            'ingredient_id' => null,
        ]);
});

it('records waste as a negative movement', function (): void {
    $item = StockItem::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'code' => 'flour-01',
        'name_en' => 'Flour',
    ]);

    $this->postJson('/api/v1/catalogue/inventory/waste', [
        'branch_id' => (string) $this->branch->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'quantity' => 3,
    ], $this->headers)->assertCreated()
        ->assertJsonPath('data.movement.quantity_delta', '-3.0000');
});

it('lists and creates stock items with an optional ingredient link', function (): void {
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
    ]);

    $this->getJson('/api/v1/catalogue/inventory/items', $this->headers)->assertOk();

    $created = $this->postJson('/api/v1/catalogue/inventory/items', [
        'code' => 'chickpeas-01',
        'name_en' => 'Chickpeas',
        'unit_code' => 'kg',
        'ingredient_id' => (string) $ingredient->getKey(),
    ], $this->headers)->assertCreated();

    $created->assertJsonPath('data.stock_item.code', 'chickpeas-01')
        ->assertJsonPath('data.stock_item.ingredient_id', (string) $ingredient->getKey());

    $this->getJson('/api/v1/catalogue/inventory/items', $this->headers)->assertOk()
        ->assertJsonFragment(['code' => 'chickpeas-01']);
});

it('refuses a duplicate stock item code for the same organisation', function (): void {
    StockItem::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'code' => 'sugar-01',
        'name_en' => 'Sugar',
    ]);

    $this->postJson('/api/v1/catalogue/inventory/items', [
        'code' => 'sugar-01',
        'name_en' => 'Sugar (again)',
    ], $this->headers)->assertUnprocessable();
});

/*
| INV1.0 re-pointed the write routes onto `inventory.manage_organisation`. The
| permission is resolved from the actual template-role grants the registry
| declares — not a hand-listed set — so this is a regression proof that the
| organisation owner (who holds every organisation permission, inventory
| included) and the kitchen manager may move stock, while kitchen staff, who
| count the shelf but never move it, get a 403 at the middleware.
*/
it('gates the inventory write endpoint on the role resolved inventory.manage grant', function (string $roleCode, bool $mayWrite): void {
    $permissions = PermissionRegistry::templateRoles()[$roleCode]['permissions'];
    $tenant = PricingWorld::kitchen("{$roleCode}@inventory.test", $permissions);
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'country_code' => $tenant->organisation->country_code,
    ]);
    $item = StockItem::query()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'code' => 'rice-01',
        'name_en' => 'Rice',
        'unit_code' => 'kg',
    ]);
    $headers = PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()];

    $response = $this->actingAs($tenant->user)->postJson('/api/v1/catalogue/inventory/adjustments', [
        'branch_id' => (string) $branch->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'quantity_delta' => 5,
    ], $headers);

    if ($mayWrite) {
        $response->assertCreated();
    } else {
        $response->assertForbidden();
    }
})->with([
    'organisation owner operates the kitchen it owns' => ['organisation_owner', true],
    'kitchen manager runs the ops surface' => ['kitchen_manager', true],
    'kitchen staff count stock but never move it' => ['kitchen_staff', false],
]);
