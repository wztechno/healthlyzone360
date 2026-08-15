<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Str;

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);
    $this->tenant = PricingWorld::kitchen('production@kitchen.test');
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant) + [
        'X-Branch-Id' => (string) $this->branch->getKey(),
    ];
});

it('lists production orders', function (): void {
    $this->getJson('/api/v1/catalogue/production/orders', $this->headers)->assertOk();
});

it('creates a production order and completes it with consumed and yielded stock', function (): void {
    $recipe = Recipe::factory()->create(['organisation_id' => $this->tenant->organisation->getKey()]);
    $version = RecipeVersion::factory()->create(['recipe_id' => $recipe->getKey()]);

    $flour = StockItem::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'code' => 'flour-01',
        'name_en' => 'Flour',
    ]);
    $bread = StockItem::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'code' => 'bread-01',
        'name_en' => 'Bread',
    ]);

    $this->postJson('/api/v1/catalogue/inventory/adjustments', [
        'branch_id' => (string) $this->branch->getKey(),
        'stock_item_id' => (string) $flour->getKey(),
        'quantity_delta' => 50,
    ], $this->headers)->assertCreated();

    $created = $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $this->branch->getKey(),
        'recipe_version_id' => (string) $version->getKey(),
        'planned_yield' => 20,
    ], $this->headers)->assertCreated()
        ->assertJsonPath('data.production_order.status', 'planned');

    $orderId = $created->json('data.production_order.id');

    $this->postJson("/api/v1/catalogue/production/orders/{$orderId}/complete", [
        'consumes' => [['stock_item_id' => (string) $flour->getKey(), 'quantity' => 10]],
        'yields' => [['stock_item_id' => (string) $bread->getKey(), 'quantity' => 20]],
    ], $this->headers)->assertOk()
        ->assertJsonPath('data.production_order.status', 'completed');

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $flour->getKey())->value('quantity'))->toBe('40.0000');
    expect(StockLevel::withoutTenancy()->where('stock_item_id', $bread->getKey())->value('quantity'))->toBe('20.0000');
});

it('refuses to complete a production order that does not exist', function (): void {
    $this->postJson('/api/v1/catalogue/production/orders/'.Str::uuid().'/complete', [], $this->headers)
        ->assertNotFound();
});
