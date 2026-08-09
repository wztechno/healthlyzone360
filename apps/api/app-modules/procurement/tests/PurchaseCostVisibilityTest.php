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
