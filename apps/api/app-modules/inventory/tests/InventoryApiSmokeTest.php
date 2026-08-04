<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
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

it('lists stock levels and records an adjustment', function (): void {
    $item = StockItem::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'code' => 'rice-01',
        'name_en' => 'Rice',
        'unit_code' => 'kg',
    ]);

    $this->getJson('/api/v1/catalogue/inventory/levels', $this->headers)->assertOk();

    $this->postJson('/api/v1/catalogue/inventory/adjustments', [
        'branch_id' => (string) $this->branch->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'quantity_delta' => 10,
    ], $this->headers)->assertCreated();

    expect(StockLevel::query()->where('stock_item_id', $item->getKey())->value('quantity'))->toBe('10.0000');
});
