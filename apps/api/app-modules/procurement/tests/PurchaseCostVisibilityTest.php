<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Procurement\Presenters\GoodsReceiptPresenter;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Purchase cost visibility — `inventory.view_costs_organisation` gates money
|--------------------------------------------------------------------------
|
| The same split `recipe.view_costs_organisation` draws over a technical sheet:
| a person may record a delivery and count what is on the shelf without being
| allowed to read what it cost. The presenter is where the redaction lives, and
| the routes are where the gate decides; both are pinned here.
|
| SUP2 extends this file rather than starting a second one, because the two
| things it adds are the same subject read from two more places: the supplier
| page's supplied items and the item-level latest purchase both redact the money
| and keep the warehouse facts. The ledger's new `stock_item_id`/`branch_id`
| filters are pinned here too — the ledger endpoint already lives in this file,
| and the deep links that use those filters are cost-gated surfaces.
|
*/

/**
 * A kitchen whose user holds exactly $permissions, with one priced receipt of
 * flour already posted into it.
 *
 * @param  list<string>  $permissions
 */
function costWorld(string $email, array $permissions): object
{
    $tenant = PricingWorld::kitchen($email, $permissions);
    $organisation = $tenant->organisation;
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'country_code' => $organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation((string) $tenant->user->getKey(), (string) $organisation->getKey());

    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $supplier = Supplier::query()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'SUP-1',
        'name_en' => 'Gulf Fresh',
        'currency_code' => 'USD',
    ]);

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    $item = StockItem::query()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'FLR-1',
        'name_en' => 'Flour',
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    $receipt = app(GoodsReceiptService::class)->post(
        (string) $organisation->getKey(),
        (string) $branch->getKey(),
        (string) $supplier->getKey(),
        'DN-2001',
        null,
        [[
            'stock_item_id' => (string) $item->getKey(),
            'quantity' => '10',
            'unit_id' => (string) $kg->getKey(),
            'unit_price_amount' => '2.00',
            'cost_currency_code' => 'USD',
        ]],
    );

    app(TenantContext::class)->clear();

    return (object) [
        'tenant' => $tenant,
        'organisation' => $organisation,
        'branch' => $branch,
        'receiptId' => (string) $receipt->getKey(),
        'headers' => PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()],
    ];
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

it('serves the money when costs are visible and redacts it when they are not', function (): void {
    $world = costWorld('presenter@kitchen.test', PricingWorld::FULL_PERMISSIONS);

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), (string) $world->organisation->getKey());

    $receipt = GoodsReceipt::query()->with(['lines', 'supplier'])->findOrFail($world->receiptId);
    $presenter = app(GoodsReceiptPresenter::class);

    $shown = $presenter->receipt($receipt, showCosts: true);
    expect($shown['costs_redacted'])->toBeFalse()
        ->and($shown['currency_code'])->toBe('USD')
        ->and($shown['receipt_total_amount'])->toBe('20.000000')
        ->and($shown['lines'][0]['unit_price_amount'])->toBe('2.000000')
        ->and($shown['lines'][0]['line_total_amount'])->toBe('20.000000')
        ->and($shown['lines'][0]['quantity'])->toBe('10.0000');

    $hidden = $presenter->receipt($receipt, showCosts: false);
    expect($hidden['costs_redacted'])->toBeTrue()
        ->and($hidden['currency_code'])->toBeNull()
        ->and($hidden['receipt_total_amount'])->toBeNull()
        ->and($hidden['lines'][0]['unit_price_amount'])->toBeNull()
        ->and($hidden['lines'][0]['line_total_amount'])->toBeNull()
        ->and($hidden['lines'][0]['cost_currency_code'])->toBeNull()
        // The quantity and unit are warehouse facts, never redacted.
        ->and($hidden['lines'][0]['quantity'])->toBe('10.0000');

    app(TenantContext::class)->clear();
});

it('redacts receipt costs and forbids the ledger for a manager without the cost permission', function (): void {
    $world = costWorld('clerk@kitchen.test', [
        'organisation.view_current',
        'branch.view_current',
        'inventory.view_organisation',
        'inventory.manage_organisation',
    ]);

    $this->actingAs($world->tenant->user);

    $this->getJson('/api/v1/catalogue/procurement/goods-receipts', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.goods_receipts.0.costs_redacted', true)
        ->assertJsonPath('data.goods_receipts.0.lines.0.unit_price_amount', null)
        ->assertJsonPath('data.goods_receipts.0.lines.0.quantity', '10.0000');

    $this->getJson('/api/v1/catalogue/procurement/purchases-ledger', $world->headers)
        ->assertForbidden();
});

it('shows the money and the ledger to a manager who holds the cost permission', function (): void {
    $world = costWorld('viewer@kitchen.test', PricingWorld::FULL_PERMISSIONS);

    $this->actingAs($world->tenant->user);

    $this->getJson('/api/v1/catalogue/procurement/goods-receipts', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.goods_receipts.0.costs_redacted', false)
        ->assertJsonPath('data.goods_receipts.0.lines.0.unit_price_amount', '2.000000')
        ->assertJsonPath('data.goods_receipts.0.receipt_total_amount', '20.000000');

    $this->getJson('/api/v1/catalogue/procurement/purchases-ledger', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.purchases.0.unit_price_amount', '2.000000')
        ->assertJsonPath('data.purchases.0.item_name_en', 'Flour');
});

/*
|--------------------------------------------------------------------------
| SUP2 — the supplied-items last price, and the ledger deep-link filters
|--------------------------------------------------------------------------
*/

it('redacts a supplied item\'s last price while keeping the date, quantity and unit', function (): void {
    $world = costWorld('supplied-clerk@kitchen.test', [
        'organisation.view_current',
        'branch.view_current',
        'inventory.view_organisation',
        'inventory.manage_organisation',
    ]);

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), (string) $world->organisation->getKey());
    $supplier = Supplier::query()->sole();
    $item = StockItem::query()->sole();
    SupplierStockItem::query()->create([
        'organisation_id' => (string) $world->organisation->getKey(),
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'is_preferred' => true,
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($world->tenant->user);

    $this->getJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}", $world->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier.costs_redacted', true)
        ->assertJsonPath('data.supplier.supplied_items.0.is_preferred', true)
        ->assertJsonPath('data.supplier.supplied_items.0.last_purchase.unit_price_amount', null)
        ->assertJsonPath('data.supplier.supplied_items.0.last_purchase.cost_currency_code', null)
        // Warehouse facts, never redacted — and what keeps "Hidden" distinct
        // from "never bought here" on screen.
        ->assertJsonPath('data.supplier.supplied_items.0.last_purchase.quantity', '10.0000')
        ->assertJsonPath('data.supplier.supplied_items.0.last_purchase.unit_code', 'kg');

    // The item-level read is the same split rather than a 403: blanking the
    // whole column would hide *that* something was bought, which this reader
    // may know.
    $this->getJson(
        '/api/v1/catalogue/procurement/item-purchases/latest?'.http_build_query([
            'stock_item_ids' => [(string) $item->getKey()],
        ]),
        $world->headers,
    )
        ->assertOk()
        ->assertJsonPath('meta.costs_redacted', true)
        ->assertJsonPath('data.purchases.0.unit_price_amount', null)
        ->assertJsonPath('data.purchases.0.quantity', '10.0000')
        ->assertJsonPath('data.purchases.0.supplier.name_en', 'Gulf Fresh');
});

it('serves the supplied item\'s money and the item-level price to a cost holder', function (): void {
    $world = costWorld('supplied-viewer@kitchen.test', PricingWorld::FULL_PERMISSIONS);

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), (string) $world->organisation->getKey());
    $supplier = Supplier::query()->sole();
    $item = StockItem::query()->sole();
    SupplierStockItem::query()->create([
        'organisation_id' => (string) $world->organisation->getKey(),
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'is_preferred' => false,
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($world->tenant->user);

    $this->getJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}", $world->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier.costs_redacted', false)
        ->assertJsonPath('data.supplier.supplied_items.0.last_purchase.unit_price_amount', '2.000000')
        ->assertJsonPath('data.supplier.supplied_items.0.last_purchase.cost_currency_code', 'USD')
        ->assertJsonPath('data.supplier.supplied_items.0.last_purchase.document_ref', 'DN-2001');

    $this->getJson(
        '/api/v1/catalogue/procurement/item-purchases/latest?'.http_build_query([
            'stock_item_ids' => [(string) $item->getKey()],
        ]),
        $world->headers,
    )
        ->assertOk()
        ->assertJsonPath('meta.costs_redacted', false)
        ->assertJsonPath('meta.requested_count', 1)
        ->assertJsonPath('data.purchases.0.stock_item_id', (string) $item->getKey())
        ->assertJsonPath('data.purchases.0.unit_price_amount', '2.000000');
});

it('filters the ledger by stock item and by branch, and refuses another kitchen\'s identifiers', function (): void {
    $world = costWorld('ledger-filters@kitchen.test', PricingWorld::FULL_PERMISSIONS);

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), (string) $world->organisation->getKey());
    $flour = StockItem::query()->sole();

    // A second shelf and a second branch, so a filter that did nothing would be
    // visible rather than accidentally right.
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $world->organisation->getKey(),
        'default_unit_id' => (string) $kg->getKey(),
    ]);
    $sugar = StockItem::query()->create([
        'organisation_id' => $world->organisation->getKey(),
        'code' => 'SUG-1',
        'name_en' => 'Sugar',
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    $secondBranch = OrganisationBranch::factory()->create([
        'organisation_id' => $world->organisation->getKey(),
        'country_code' => $world->organisation->country_code,
    ]);

    app(GoodsReceiptService::class)->post(
        (string) $world->organisation->getKey(),
        (string) $secondBranch->getKey(),
        null,
        'DN-3001',
        null,
        [[
            'stock_item_id' => (string) $sugar->getKey(),
            'quantity' => '5',
            'unit_id' => (string) $kg->getKey(),
            'unit_price_amount' => '1.50',
            'cost_currency_code' => 'USD',
        ]],
    );
    app(TenantContext::class)->clear();

    $this->actingAs($world->tenant->user);

    $byItem = $this->getJson(
        '/api/v1/catalogue/procurement/purchases-ledger?stock_item_id='.$sugar->getKey(),
        $world->headers,
    )->assertOk();

    expect($byItem->json('data.purchases'))->toHaveCount(1)
        ->and($byItem->json('data.purchases.0.item_name_en'))->toBe('Sugar');

    $byBranch = $this->getJson(
        '/api/v1/catalogue/procurement/purchases-ledger?branch_id='.$world->branch->getKey(),
        $world->headers,
    )->assertOk();

    expect($byBranch->json('data.purchases'))->toHaveCount(1)
        ->and($byBranch->json('data.purchases.0.item_name_en'))->toBe('Flour');

    // An identifier from another kitchen is a 422, not an empty page that
    // reads like a fact about this one.
    $other = costWorld('ledger-other@kitchen.test', PricingWorld::FULL_PERMISSIONS);

    $this->actingAs($world->tenant->user);

    $this->getJson(
        '/api/v1/catalogue/procurement/purchases-ledger?branch_id='.$other->branch->getKey(),
        $world->headers,
    )->assertStatus(422);

    $this->getJson(
        '/api/v1/catalogue/procurement/purchases-ledger?stock_item_id='.$flour->getKey().'&branch_id='.$other->branch->getKey(),
        $world->headers,
    )->assertStatus(422);
});
