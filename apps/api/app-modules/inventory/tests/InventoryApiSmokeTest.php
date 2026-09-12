<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\StockItemDerivationService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Support\Str;

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

/*
| The index used to be half of a list-and-create test. There is no create any
| more (INV2.0) — declaring an ingredient *is* how a shelf comes into being — so
| what is worth proving is the read contract the pickers depend on: every
| ingredient is listed, tagged with what backs it, and ranked so the shelves a
| kitchen actually uses are not buried under two hundred it does not.
*/
it('lists a shelf for every ingredient, tagged by backing and ranked with the stocked ones first', function (): void {
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    Ingredient::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'name_en' => 'Aubergine',
        'default_unit_id' => (string) $kg->getKey(),
    ]);
    $chickpeas = Ingredient::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'name_en' => 'Chickpeas',
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    // Both shelves exist already; only one holds anything.
    $stocked = StockItem::withoutTenancy()->where('ingredient_id', (string) $chickpeas->getKey())->sole();

    $this->postJson('/api/v1/catalogue/inventory/adjustments', [
        'branch_id' => (string) $this->branch->getKey(),
        'stock_item_id' => (string) $stocked->getKey(),
        'quantity_delta' => 12,
    ], $this->headers)->assertCreated();

    $response = $this->getJson('/api/v1/catalogue/inventory/items', $this->headers)->assertOk();

    $response->assertJsonFragment([
        'name_en' => 'Chickpeas',
        'backing' => 'ingredient',
        'is_stocked' => true,
    ]);

    // Chickpeas holds twelve kilograms and Aubergine holds nothing, so the
    // picker meets Chickpeas first despite losing on the alphabet.
    $names = collect($response->json('data.stock_items'))->pluck('name_en');

    expect($names->first())->toBe('Chickpeas')
        ->and($names)->toContain('Aubergine');
});

/*
| Stock item codes stay unique per organisation — the same guarantee this file
| used to prove by posting a duplicate to `POST /inventory/items` and asserting a
| 422. That endpoint is gone (INV2.0): stock items are derived, so nobody can
| offer a duplicate, and the guarantee moved from "the API refuses yours" to
| "derivation never mints one".
|
| The case that would actually collide is a platform-library ingredient and a
| kitchen's own sharing a slug — `ingredients` is unique on
| `(organisation_id, slug)` with NULLS NOT DISTINCT, so the two can coexist and
| both derive into the same kitchen.
*/
it('mints distinct stock item codes when a library ingredient and a kitchen ingredient share a slug', function (): void {
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    Ingredient::factory()->create([
        'organisation_id' => null,
        'slug' => 'sugar',
        'name_en' => 'Sugar',
        'default_unit_id' => (string) $kg->getKey(),
    ]);
    Ingredient::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'slug' => 'sugar',
        'name_en' => 'Sugar (house)',
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    app(StockItemDerivationService::class)->syncOrganisation((string) $this->tenant->organisation->getKey());

    $codes = StockItem::withoutTenancy()
        ->where('organisation_id', $this->tenant->organisation->getKey())
        ->pluck('code');

    expect($codes)->toHaveCount($codes->unique()->count())
        ->and($codes)->toContain('sugar')
        ->and($codes)->toContain('sugar-2');
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

/*
| The review list reads its filter off the query string, where a boolean can
| only arrive as a word. Laravel's `boolean` rule refuses `false` spelled out,
| so the list 422'd on every load until the rule matched the wire — hence a test
| that sends exactly what the client sends.
*/
it('filters the consumption exception list on a resolved flag spelled as a word', function (): void {
    $open = OrderConsumptionException::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'order_id' => (string) Str::uuid(),
        'reason_code' => 'no_recipe_version',
    ]);
    OrderConsumptionException::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'order_id' => (string) Str::uuid(),
        'reason_code' => 'no_stock_item',
        'resolved_at' => now(),
    ]);

    $this->getJson('/api/v1/catalogue/inventory/consumption-exceptions?resolved=false', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data.exceptions')
        ->assertJsonPath('data.exceptions.0.id', (string) $open->getKey());

    $this->getJson('/api/v1/catalogue/inventory/consumption-exceptions?resolved=true', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data.exceptions')
        ->assertJsonPath('data.exceptions.0.resolved', true);

    $this->getJson('/api/v1/catalogue/inventory/consumption-exceptions?resolved=banana', $this->headers)
        ->assertStatus(422);
});
