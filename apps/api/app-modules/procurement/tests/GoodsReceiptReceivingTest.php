<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Enums\PurchaseOrderStatus;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\PurchaseOrderLine;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\PurchaseOrderService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Receiving against a purchase order (SUP5) — §3.5, §3.6, §4
|--------------------------------------------------------------------------
|
| The claims this file pins are the ones a screen cannot make for itself:
|
| - **a delivery must belong to its order.** Wrong supplier, wrong branch, wrong
|   status, an order line from another order, an order line for another shelf —
|   each refused, and each with a shape a client can act on rather than one
|   generic error.
| - **received quantities sum per line and the status is a reading of the sum.**
|   Nobody presses "received"; two partial deliveries reach it and one full one
|   reaches it directly.
| - **over-receipt and short-close both need somebody to say why.** §3.5 asks for
|   a confirmation *and* a note, and a required explanation that was discarded
|   would be the plainest kind of silent behaviour.
| - **one transaction.** A batch that fails halfway leaves no receipt, no line,
|   no stock movement and no level change. That last one is the expensive
|   mistake: a half-posted delivery is stock nobody can reconcile.
| - **the direct path is unchanged.** A market purchase with no order still
|   posts exactly as it did before this slice.
|
*/

/**
 * A kitchen, a branch, a supplier, one ingredient-backed shelf in kilograms, and
 * a caller holding everything.
 */
function receivingWorld(string $email): object
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

    app(TenantContext::class)->clear();

    return (object) [
        'tenant' => $tenant,
        'organisation' => $organisation,
        'organisationId' => (string) $organisation->getKey(),
        'branch' => $branch,
        'branchId' => (string) $branch->getKey(),
        'supplier' => $supplier,
        'supplierId' => (string) $supplier->getKey(),
        'item' => $item,
        'itemId' => (string) $item->getKey(),
        'kgId' => (string) $kg->getKey(),
        'headers' => PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()],
    ];
}

/**
 * An issued order for `$quantity` of the world's shelf.
 */
function issuedOrder(object $world, string $quantity = '10'): PurchaseOrder
{
    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);

    $orders = app(PurchaseOrderService::class);

    $created = $orders->createBatch($world->organisationId, $world->branchId, [[
        'supplier_id' => $world->supplierId,
        'lines' => [['stock_item_id' => $world->itemId, 'quantity' => $quantity]],
    ]]);

    $order = $orders->issue($created[0]);

    app(TenantContext::class)->clear();

    return $order;
}

function orderLineId(PurchaseOrder $order): string
{
    return (string) PurchaseOrderLine::query()->where('purchase_order_id', $order->getKey())->sole()->getKey();
}

/**
 * Post a delivery as the world's caller, inside its tenant context.
 *
 * @param  list<array<string, mixed>>  $lines
 * @param  array<string, mixed>  $extra
 */
function receive(object $world, ?PurchaseOrder $order, array $lines, array $extra = []): GoodsReceipt
{
    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);

    try {
        return app(GoodsReceiptService::class)->post(
            $world->organisationId,
            $extra['branch_id'] ?? $world->branchId,
            array_key_exists('supplier_id', $extra) ? $extra['supplier_id'] : $world->supplierId,
            $extra['document_ref'] ?? 'DN-1',
            $order?->getKey() === null ? null : (string) $order->getKey(),
            $lines,
            receivedOn: $extra['received_on'] ?? null,
            supplierInvoiceRef: $extra['supplier_invoice_ref'] ?? null,
            invoiceDate: $extra['invoice_date'] ?? null,
            charges: $extra['charges'] ?? [],
            varianceNote: $extra['variance_note'] ?? null,
            overReceiptConfirmed: $extra['over_receipt_confirmed'] ?? false,
            closeShort: $extra['close_short'] ?? false,
            closeShortReason: $extra['close_short_reason'] ?? null,
        );
    } finally {
        app(TenantContext::class)->clear();
    }
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

/* ── the against-order validation matrix ─────────────────────────────────── */

it('refuses a delivery against an order whose supplier is not the one delivering', function (): void {
    $world = receivingWorld('supplier-mismatch@kitchen.test');
    $order = issuedOrder($world);

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    $other = Supplier::query()->create([
        'organisation_id' => $world->organisationId,
        'code' => 'SUP-2',
        'name_en' => 'Someone else',
    ]);
    app(TenantContext::class)->clear();

    $post = fn () => receive(
        $world,
        $order,
        [['stock_item_id' => $world->itemId, 'quantity' => '1', 'purchase_order_line_id' => orderLineId($order)]],
        ['supplier_id' => (string) $other->getKey()],
    );

    expect($post)->toThrow(
        ApiException::class,
        'This delivery names a different supplier from the one the order was addressed to.',
    );

    // Nothing was written — the refusal happens before any row exists.
    expect(GoodsReceipt::withoutTenancy()->count())->toBe(0)
        ->and(StockMovement::withoutTenancy()->count())->toBe(0);
});

it('refuses a delivery received at a branch that did not order it', function (): void {
    $world = receivingWorld('branch-mismatch@kitchen.test');
    $order = issuedOrder($world);

    $elsewhere = OrganisationBranch::factory()->create([
        'organisation_id' => $world->organisation->getKey(),
        'country_code' => $world->organisation->country_code,
    ]);

    $post = fn () => receive(
        $world,
        $order,
        [['stock_item_id' => $world->itemId, 'quantity' => '1', 'purchase_order_line_id' => orderLineId($order)]],
        ['branch_id' => (string) $elsewhere->getKey()],
    );

    expect($post)->toThrow(ApiException::class);
    expect(GoodsReceipt::withoutTenancy()->count())->toBe(0);
});

it('refuses a delivery against an order that is still a draft', function (): void {
    $world = receivingWorld('draft-order@kitchen.test');

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    $draft = app(PurchaseOrderService::class)->createBatch($world->organisationId, $world->branchId, [[
        'supplier_id' => $world->supplierId,
        'lines' => [['stock_item_id' => $world->itemId, 'quantity' => '5']],
    ]])[0];
    app(TenantContext::class)->clear();

    $post = fn () => receive($world, $draft, [['stock_item_id' => $world->itemId, 'quantity' => '1']]);

    expect($post)->toThrow(
        ApiException::class,
        'Only an issued or partially received purchase order can be delivered against.',
    );
});

it('refuses a line naming an order line that stocks a different item', function (): void {
    $world = receivingWorld('line-mismatch@kitchen.test');
    $order = issuedOrder($world);

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    $sugar = StockItem::query()->create([
        'organisation_id' => $world->organisationId,
        'code' => 'SUG-1',
        'name_en' => 'Sugar',
        'unit_code' => 'kg',
        'unit_id' => $world->kgId,
        'ingredient_id' => null,
    ]);
    app(TenantContext::class)->clear();

    $post = fn () => receive($world, $order, [[
        'stock_item_id' => (string) $sugar->getKey(),
        'quantity' => '1',
        // The order line is for flour, not sugar.
        'purchase_order_line_id' => orderLineId($order),
    ]]);

    expect($post)->toThrow(ApiException::class, 'That order line was for a different item.');
});

it('refuses a line naming an order line that belongs to another order', function (): void {
    $world = receivingWorld('foreign-line@kitchen.test');
    $order = issuedOrder($world);
    $other = issuedOrder($world, '4');

    $post = fn () => receive($world, $order, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '1',
        'purchase_order_line_id' => orderLineId($other),
    ]]);

    expect($post)->toThrow(ApiException::class, 'That order line is not on this purchase order.');
});

/* ── partial receipts, sums and the status flip ──────────────────────────── */

it('flips an issued order to partially received and sums the quantity per line', function (): void {
    $world = receivingWorld('partial@kitchen.test');
    $order = issuedOrder($world, '10');
    $lineId = orderLineId($order);

    receive($world, $order, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '4',
        'unit_id' => $world->kgId,
        'unit_price_amount' => '2.00',
        'cost_currency_code' => 'USD',
        'purchase_order_line_id' => $lineId,
    ]]);

    $order->refresh();

    expect($order->status)->toBe(PurchaseOrderStatus::PartiallyReceived)
        ->and($order->received_at)->toBeNull()
        ->and($order->closed_at)->toBeNull();

    // The shelf rose once, by exactly what arrived.
    expect(StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->value('quantity'))->toBe('4.0000')
        ->and(StockMovement::withoutTenancy()->count())->toBe(1);

    // A priced line is settled, so the receipt's paperwork is done.
    $receipt = GoodsReceipt::withoutTenancy()->sole();
    expect($receipt->cost_status)->toBe('complete')
        ->and($receipt->purchase_order_id)->toBe((string) $order->getKey());
});

it('reaches received when two partial deliveries together fulfil every line', function (): void {
    $world = receivingWorld('two-partials@kitchen.test');
    $order = issuedOrder($world, '10');
    $lineId = orderLineId($order);

    // Two deliveries at two different prices — §3.5 is explicit that this is
    // legitimate rather than a correction.
    receive($world, $order, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '6',
        'unit_id' => $world->kgId,
        'unit_price_amount' => '2.00',
        'cost_currency_code' => 'USD',
        'purchase_order_line_id' => $lineId,
    ]]);

    expect($order->refresh()->status)->toBe(PurchaseOrderStatus::PartiallyReceived);

    receive($world, $order, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '4',
        'unit_id' => $world->kgId,
        'unit_price_amount' => '2.50',
        'cost_currency_code' => 'USD',
        'purchase_order_line_id' => $lineId,
    ]], ['document_ref' => 'DN-2']);

    $order->refresh();

    expect($order->status)->toBe(PurchaseOrderStatus::Received)
        ->and($order->received_at)->not->toBeNull()
        ->and($order->closed_at)->not->toBeNull()
        ->and($order->close_short_reason)->toBeNull();

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->value('quantity'))->toBe('10.0000')
        ->and(StockMovement::withoutTenancy()->count())->toBe(2)
        ->and(GoodsReceipt::withoutTenancy()->count())->toBe(2);
});

it('goes straight to received when one delivery fulfils the whole order', function (): void {
    $world = receivingWorld('one-shot@kitchen.test');
    $order = issuedOrder($world, '10');

    receive($world, $order, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '10',
        'unit_id' => $world->kgId,
        'purchase_order_line_id' => orderLineId($order),
    ]]);

    expect($order->refresh()->status)->toBe(PurchaseOrderStatus::Received);
});

it('sums a delivery quoted in a different unit from the ordered line', function (): void {
    // The order is for 10 kg; 4000 g arrives. Both are converted into the
    // shelf's own unit before anything is compared, so this is 4 of the 10.
    $world = receivingWorld('unit-sum@kitchen.test');
    $order = issuedOrder($world, '10');
    $grams = MeasurementUnit::query()->where('code', 'g')->sole();

    receive($world, $order, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '4000',
        'unit_id' => (string) $grams->getKey(),
        'purchase_order_line_id' => orderLineId($order),
    ]]);

    expect($order->refresh()->status)->toBe(PurchaseOrderStatus::PartiallyReceived)
        ->and(StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->value('quantity'))->toBe('4.0000');
});

/* ── over-receipt ────────────────────────────────────────────────────────── */

it('refuses an over-receipt, then records it with a confirmation and a note', function (): void {
    $world = receivingWorld('over@kitchen.test');
    $order = issuedOrder($world, '10');
    $lineId = orderLineId($order);

    $line = [
        'stock_item_id' => $world->itemId,
        'quantity' => '12',
        'unit_id' => $world->kgId,
        'purchase_order_line_id' => $lineId,
    ];

    expect(fn () => receive($world, $order, [$line]))
        ->toThrow(ApiException::class, 'This delivery is more than the order still has outstanding.');

    // Confirmed but unexplained is still refused: §3.5 asks for both.
    expect(fn () => receive($world, $order, [$line], ['over_receipt_confirmed' => true]))
        ->toThrow(ApiException::class, 'An over-receipt needs a note saying why more arrived than was ordered.');

    expect(GoodsReceipt::withoutTenancy()->count())->toBe(0)
        ->and(StockMovement::withoutTenancy()->count())->toBe(0);

    receive($world, $order, [$line], [
        'over_receipt_confirmed' => true,
        'variance_note' => 'Supplier sent the next size up and asked us to keep it.',
    ]);

    $order->refresh();
    $receipt = GoodsReceipt::withoutTenancy()->sole();

    expect($order->status)->toBe(PurchaseOrderStatus::Received)
        ->and($receipt->variance_note)->toBe('Supplier sent the next size up and asked us to keep it.')
        ->and(StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->value('quantity'))->toBe('12.0000');
});

it('requires a note for an unplanned item on a delivery against an order', function (): void {
    $world = receivingWorld('unplanned@kitchen.test');
    $order = issuedOrder($world, '10');

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    $extra = StockItem::query()->create([
        'organisation_id' => $world->organisationId,
        'code' => 'PKG-1',
        'name_en' => 'Takeaway boxes',
        'unit_code' => 'piece',
        'unit_id' => (string) MeasurementUnit::query()->where('code', 'piece')->value('id'),
        'ingredient_id' => null,
    ]);
    app(TenantContext::class)->clear();

    $lines = [
        ['stock_item_id' => $world->itemId, 'quantity' => '10', 'unit_id' => $world->kgId, 'purchase_order_line_id' => orderLineId($order)],
        // No order line: this was never asked for.
        ['stock_item_id' => (string) $extra->getKey(), 'quantity' => '50'],
    ];

    expect(fn () => receive($world, $order, $lines))
        ->toThrow(ApiException::class, 'An item that was not on this order needs a note saying why it is on the delivery.');

    receive($world, $order, $lines, ['variance_note' => 'Driver brought the boxes we chased last week.']);

    expect(GoodsReceipt::withoutTenancy()->sole()->variance_note)->toBe('Driver brought the boxes we chased last week.');
});

/* ── closing a delivery short ────────────────────────────────────────────── */

it('closes the rest of an order with a reason and a closed stamp', function (): void {
    $world = receivingWorld('short@kitchen.test');
    $order = issuedOrder($world, '10');

    receive($world, $order, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '7',
        'unit_id' => $world->kgId,
        'purchase_order_line_id' => orderLineId($order),
    ]], [
        'close_short' => true,
        'close_short_reason' => 'Supplier discontinued the 5 kg pack.',
    ]);

    $order->refresh();

    expect($order->status)->toBe(PurchaseOrderStatus::Received)
        ->and($order->closed_at)->not->toBeNull()
        ->and($order->close_short_reason)->toBe('Supplier discontinued the 5 kg pack.')
        // Nothing was "last fulfilled", so there is no received date to claim.
        ->and($order->received_at)->toBeNull();
});

it('refuses to close an order short without a reason', function (): void {
    $world = receivingWorld('short-blank@kitchen.test');
    $order = issuedOrder($world, '10');

    $post = fn () => receive($world, $order, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '7',
        'unit_id' => $world->kgId,
        'purchase_order_line_id' => orderLineId($order),
    ]], ['close_short' => true, 'close_short_reason' => '   ']);

    expect($post)->toThrow(ApiException::class, 'Closing the rest of an order needs a reason.');
});

it('stores no reason when a delivery flagged short turns out to complete the order', function (): void {
    // Nothing was left over, so there is nothing to explain. The order is
    // received for the ordinary reason and carries no write-off sentence.
    $world = receivingWorld('short-but-complete@kitchen.test');
    $order = issuedOrder($world, '10');

    receive($world, $order, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '10',
        'unit_id' => $world->kgId,
        'purchase_order_line_id' => orderLineId($order),
    ]], ['close_short' => true, 'close_short_reason' => 'Not needed after all']);

    $order->refresh();

    expect($order->status)->toBe(PurchaseOrderStatus::Received)
        ->and($order->close_short_reason)->toBeNull()
        ->and($order->received_at)->not->toBeNull();
});

/* ── invoice arithmetic and the single currency ──────────────────────────── */

it('refuses an invoice total that does not match the lines and charges', function (): void {
    $world = receivingWorld('invoice-maths@kitchen.test');

    $line = [
        'stock_item_id' => $world->itemId,
        'quantity' => '10',
        'unit_id' => $world->kgId,
        'unit_price_amount' => '2.00',
        'cost_currency_code' => 'USD',
    ];

    // 20 subtotal − 1 discount + 2 tax + 3 delivery = 24, not 30.
    $post = fn () => receive($world, null, [$line], ['charges' => [
        'discount_amount' => '1.00',
        'tax_amount' => '2.00',
        'delivery_amount' => '3.00',
        'invoice_total_amount' => '30.00',
    ]]);

    expect($post)->toThrow(ApiException::class, 'The invoice total does not match the lines and charges on this receipt.');

    receive($world, null, [$line], ['charges' => [
        'discount_amount' => '1.00',
        'tax_amount' => '2.00',
        'delivery_amount' => '3.00',
        'invoice_total_amount' => '24.00',
    ]]);

    $receipt = GoodsReceipt::withoutTenancy()->sole();

    expect((string) $receipt->invoice_total_amount)->toBe('24.000000')
        ->and((string) $receipt->delivery_amount)->toBe('3.000000');
});

it('refuses a receipt charge when no line carries a price to give it a currency', function (): void {
    $world = receivingWorld('charge-no-currency@kitchen.test');

    $post = fn () => receive(
        $world,
        null,
        [['stock_item_id' => $world->itemId, 'quantity' => '10', 'unit_id' => $world->kgId]],
        ['charges' => ['delivery_amount' => '5.00']],
    );

    expect($post)->toThrow(ApiException::class, 'A receipt charge needs a currency');
});

/* ── the business date ───────────────────────────────────────────────────── */

it('files a delivery under the branch-local day and refuses a date that has not arrived', function (): void {
    $world = receivingWorld('dates@kitchen.test');

    $yesterday = now()->subDay()->toDateString();

    $receipt = receive(
        $world,
        null,
        [['stock_item_id' => $world->itemId, 'quantity' => '1', 'unit_id' => $world->kgId]],
        ['received_on' => $yesterday, 'supplier_invoice_ref' => 'INV-77', 'invoice_date' => $yesterday],
    );

    expect($receipt->received_on?->toDateString())->toBe($yesterday)
        ->and($receipt->supplier_invoice_ref)->toBe('INV-77')
        // The instant stays inside the day it is filed under.
        ->and($receipt->received_at?->toDateString())->toBe($yesterday);

    $future = fn () => receive(
        $world,
        null,
        [['stock_item_id' => $world->itemId, 'quantity' => '1', 'unit_id' => $world->kgId]],
        ['received_on' => now()->addWeek()->toDateString()],
    );

    expect($future)->toThrow(ApiException::class, 'A delivery cannot be received on a date that has not arrived at this branch yet.');
});

/* ── one transaction ─────────────────────────────────────────────────────── */

it('leaves no receipt, no line, no movement and no level when one line of a batch fails', function (): void {
    $world = receivingWorld('atomic@kitchen.test');
    $order = issuedOrder($world, '10');

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    $sugar = StockItem::query()->create([
        'organisation_id' => $world->organisationId,
        'code' => 'SUG-1',
        'name_en' => 'Sugar',
        'unit_code' => 'kg',
        'unit_id' => $world->kgId,
        'ingredient_id' => null,
    ]);
    app(TenantContext::class)->clear();

    // The first line is perfectly good and would have raised stock; the second
    // names an order line for a different shelf and refuses the whole post.
    $post = fn () => receive($world, $order, [
        ['stock_item_id' => $world->itemId, 'quantity' => '3', 'unit_id' => $world->kgId, 'purchase_order_line_id' => orderLineId($order)],
        ['stock_item_id' => (string) $sugar->getKey(), 'quantity' => '2', 'purchase_order_line_id' => orderLineId($order)],
    ]);

    expect($post)->toThrow(ApiException::class);

    expect(GoodsReceipt::withoutTenancy()->count())->toBe(0)
        ->and(StockMovement::withoutTenancy()->count())->toBe(0)
        ->and(StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->count())->toBe(0)
        ->and($order->refresh()->status)->toBe(PurchaseOrderStatus::Issued);
});

/* ── the direct path is untouched ────────────────────────────────────────── */

it('posts a direct market purchase with no order exactly as before', function (): void {
    $world = receivingWorld('direct@kitchen.test');

    $receipt = receive($world, null, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '5',
        'unit_id' => $world->kgId,
        'unit_price_amount' => '1.80',
        'cost_currency_code' => 'USD',
    ]]);

    expect($receipt->purchase_order_id)->toBeNull()
        ->and($receipt->cost_status)->toBe('complete')
        // The business date defaults to today at the receiving branch.
        ->and($receipt->received_on)->not->toBeNull();

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->value('quantity'))->toBe('5.0000')
        ->and(StockMovement::withoutTenancy()->count())->toBe(1);
});

it('marks a receipt unpriced when the invoice has not arrived', function (): void {
    $world = receivingWorld('no-invoice@kitchen.test');

    $receipt = receive($world, null, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '5',
        'unit_id' => $world->kgId,
    ]]);

    expect($receipt->cost_status)->toBe('unpriced');
    expect($receipt->lines()->sole()->costed_at)->toBeNull();

    // The stock still rose: what arrived is not in doubt, only what it cost.
    expect(StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->value('quantity'))->toBe('5.0000');
});

it('marks a receipt partial when one line is priced and another is not', function (): void {
    $world = receivingWorld('mixed-pricing@kitchen.test');

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    $sugar = StockItem::query()->create([
        'organisation_id' => $world->organisationId,
        'code' => 'SUG-1',
        'name_en' => 'Sugar',
        'unit_code' => 'kg',
        'unit_id' => $world->kgId,
        'ingredient_id' => null,
    ]);
    app(TenantContext::class)->clear();

    $receipt = receive($world, null, [
        ['stock_item_id' => $world->itemId, 'quantity' => '5', 'unit_id' => $world->kgId, 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD'],
        ['stock_item_id' => (string) $sugar->getKey(), 'quantity' => '3', 'unit_id' => $world->kgId],
    ]);

    expect($receipt->cost_status)->toBe('partial');
});
