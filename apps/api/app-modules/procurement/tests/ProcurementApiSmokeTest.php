<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);
    $this->tenant = PricingWorld::kitchen('procurement@kitchen.test');
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant) + [
        'X-Branch-Id' => (string) $this->branch->getKey(),
    ];
});

it('lists suppliers and posts a goods receipt into inventory', function (): void {
    Supplier::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'code' => 'sup-1',
        'name_en' => 'Supplier One',
    ]);

    $item = StockItem::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'code' => 'flour',
        'name_en' => 'Flour',
    ]);

    $this->getJson('/api/v1/catalogue/procurement/suppliers', $this->headers)->assertOk();

    $receipt = $this->postJson('/api/v1/catalogue/procurement/goods-receipts', [
        'branch_id' => (string) $this->branch->getKey(),
        'lines' => [['stock_item_id' => (string) $item->getKey(), 'quantity' => 5]],
    ], $this->headers)->assertCreated();

    $receiptId = $receipt->json('data.goods_receipt.id');

    $this->getJson('/api/v1/catalogue/procurement/goods-receipts', $this->headers)->assertOk()
        ->assertJsonFragment(['id' => $receiptId])
        ->assertJsonFragment(['stock_item_id' => (string) $item->getKey(), 'quantity' => '5.0000']);

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $item->getKey())->value('quantity'))->toBe('5.0000');
});
