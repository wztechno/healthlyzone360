<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Enums\PurchaseOrderStatus;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\PurchaseOrderLine;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\PurchaseOrderService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| An order with a delivery against it cannot be cancelled (SUP5) — §3.5
|--------------------------------------------------------------------------
|
| Two guards, and the file exists because they answer differently on purpose.
|
| The **enum** refuses `partially_received → cancelled`, which covers the
| ordinary case and would answer `purchase_order_not_cancellable`. The
| **service** checks for a receipt first, and answers
| `purchase_order_received_against`. Order matters: when both apply, a caller
| should be told what actually happened — something was delivered — rather than
| be told its status again.
|
| The second guard also covers the case the enum cannot see: a receipt exists and
| the status has not caught up. It should be unreachable, and a guard that is
| only correct while nothing else is wrong is not a guard.
|
*/

/**
 * A kitchen with one issued order for 10 kg of flour.
 */
function cancelGuardWorld(string $email): object
{
    $tenant = PricingWorld::kitchen($email, PricingWorld::FULL_PERMISSIONS);
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

    $orders = app(PurchaseOrderService::class);
    $order = $orders->issue($orders->createBatch((string) $organisation->getKey(), (string) $branch->getKey(), [[
        'supplier_id' => (string) $supplier->getKey(),
        'lines' => [['stock_item_id' => (string) $item->getKey(), 'quantity' => '10']],
    ]])[0]);

    app(TenantContext::class)->clear();

    return (object) [
        'tenant' => $tenant,
        'organisationId' => (string) $organisation->getKey(),
        'branchId' => (string) $branch->getKey(),
        'supplierId' => (string) $supplier->getKey(),
        'itemId' => (string) $item->getKey(),
        'kgId' => (string) $kg->getKey(),
        'order' => $order,
        'orderId' => (string) $order->getKey(),
        'headers' => PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()],
    ];
}

/**
 * Every key at every depth of a decoded response body.
 *
 * Declared here rather than borrowed from the order-book suite beside it, on the
 * rule `ProcurementPermissionTest` states: a structural assertion that quietly
 * passed because a sibling file had been loaded first would be the test in this
 * repository worth least.
 *
 * @param  array<array-key, mixed>  $value
 * @return list<string>
 */
function cancelGuardKeys(array $value): array
{
    $keys = [];

    foreach ($value as $key => $child) {
        if (is_string($key)) {
            $keys[] = $key;
        }

        if (is_array($child)) {
            $keys = [...$keys, ...cancelGuardKeys($child)];
        }
    }

    return $keys;
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

it('cancels an issued order that nothing has been delivered against', function (): void {
    $world = cancelGuardWorld('cancellable@kitchen.test');

    $this->actingAs($world->tenant->user);

    $this->postJson("/api/v1/catalogue/procurement/purchase-orders/{$world->orderId}/cancel", [], $world->headers)
        ->assertOk()
        ->assertJsonPath('data.purchase_order.status', 'cancelled');
});

it('refuses to cancel an order once something has been delivered against it', function (): void {
    $world = cancelGuardWorld('received-against@kitchen.test');

    $lineId = (string) PurchaseOrderLine::query()->where('purchase_order_id', $world->orderId)->sole()->getKey();

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    app(GoodsReceiptService::class)->post(
        $world->organisationId,
        $world->branchId,
        $world->supplierId,
        'DN-1',
        $world->orderId,
        [['stock_item_id' => $world->itemId, 'quantity' => '3', 'unit_id' => $world->kgId, 'purchase_order_line_id' => $lineId]],
    );
    app(TenantContext::class)->clear();

    expect(PurchaseOrder::withoutTenancy()->findOrFail($world->orderId)->status)
        ->toBe(PurchaseOrderStatus::PartiallyReceived);

    $this->actingAs($world->tenant->user);

    // The reason names the situation rather than restating the status: both
    // guards apply here, and the service's runs first for exactly that reason.
    $this->postJson("/api/v1/catalogue/procurement/purchase-orders/{$world->orderId}/cancel", [], $world->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.details.reason', 'purchase_order_received_against')
        ->assertJsonPath('error.details.status', 'partially_received');

    expect(PurchaseOrder::withoutTenancy()->findOrFail($world->orderId)->status)
        ->toBe(PurchaseOrderStatus::PartiallyReceived);
});

it('refuses even when a receipt exists and the status has not caught up', function (): void {
    $world = cancelGuardWorld('stale-status@kitchen.test');

    $lineId = (string) PurchaseOrderLine::query()->where('purchase_order_id', $world->orderId)->sole()->getKey();

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);

    app(GoodsReceiptService::class)->post(
        $world->organisationId,
        $world->branchId,
        $world->supplierId,
        'DN-1',
        $world->orderId,
        [['stock_item_id' => $world->itemId, 'quantity' => '3', 'unit_id' => $world->kgId, 'purchase_order_line_id' => $lineId]],
    );

    // Force the state the enum alone could not refuse. It should be
    // unreachable; a guard that is only correct while nothing else is wrong is
    // not a guard.
    PurchaseOrder::query()->whereKey($world->orderId)->update(['status' => PurchaseOrderStatus::Issued->value]);

    app(TenantContext::class)->clear();

    $this->actingAs($world->tenant->user);

    $this->postJson("/api/v1/catalogue/procurement/purchase-orders/{$world->orderId}/cancel", [], $world->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.details.reason', 'purchase_order_received_against');
});

it('shows ordered, received and outstanding quantities and the linked receipts on the order', function (): void {
    $world = cancelGuardWorld('order-detail@kitchen.test');

    $lineId = (string) PurchaseOrderLine::query()->where('purchase_order_id', $world->orderId)->sole()->getKey();

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    app(GoodsReceiptService::class)->post(
        $world->organisationId,
        $world->branchId,
        $world->supplierId,
        'DN-77',
        $world->orderId,
        [['stock_item_id' => $world->itemId, 'quantity' => '4', 'unit_id' => $world->kgId, 'purchase_order_line_id' => $lineId]],
    );
    app(TenantContext::class)->clear();

    $this->actingAs($world->tenant->user);

    $body = $this->getJson("/api/v1/catalogue/procurement/purchase-orders/{$world->orderId}", $world->headers)
        ->assertOk()
        ->assertJsonPath('data.purchase_order.status', 'partially_received')
        ->assertJsonPath('data.purchase_order.lines.0.quantity', '10.0000')
        ->assertJsonPath('data.purchase_order.lines.0.received_quantity', '4.0000')
        ->assertJsonPath('data.purchase_order.lines.0.outstanding_quantity', '6.0000')
        ->assertJsonPath('data.purchase_order.receipts.0.document_ref', 'DN-77')
        ->assertJsonPath('data.purchase_order.receipts.0.line_count', 1)
        ->json();

    // §3.5's structural boundary still holds with the new fields on the shape:
    // no money anywhere on a purchase-order response, at any depth.
    foreach (cancelGuardKeys($body) as $key) {
        expect($key)->not->toMatch('/amount|price|cost|currency/i');
    }
});
