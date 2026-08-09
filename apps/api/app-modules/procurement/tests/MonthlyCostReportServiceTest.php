<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Database\Factories\SalesChannelFactory;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Services\MonthlyCostReportService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| MonthlyCostReportService — the report aggregation math (INV1.4)
|--------------------------------------------------------------------------
|
| The report reconciles three ledgers into a per-(month, currency) margin, and
| every one of its rules is a way to get a real number wrong: summing a cancelled
| order's COGS, summing two currencies, mis-scaling minor against major units, or
| presenting an understated month as complete. These tests pin exactly those.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('report@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();

    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->orgId,
        'country_code' => $this->organisation->country_code,
    ]);
    $this->branchId = (string) $this->branch->getKey();

    app(TenantContext::class)->setOrganisation((string) $this->tenant->user->getKey(), $this->orgId);

    $this->stockItem = StockItem::query()->create([
        'organisation_id' => $this->orgId,
        'code' => 'sku-report',
        'name_en' => 'Report ingredient',
        'unit_code' => 'kg',
    ]);
    $this->stockItemId = (string) $this->stockItem->getKey();

    $catalogue = Catalogue::factory()->create(['organisation_id' => $this->orgId]);
    $this->meal = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->orgId,
    ]);
    $this->product = CatalogueItem::factory()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->orgId,
    ]);

    $this->service = app(MonthlyCostReportService::class);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/** An order for this kitchen with the given status, total, currency and confirm date. */
function reportOrder(object $test, OrderStatus $status, int $totalMinor, ?string $confirmedAt, string $currency = 'USD'): Order
{
    $customer = CustomerAccountFactory::new()->create();
    $channel = SalesChannelFactory::new()->create(['organisation_id' => $test->orgId]);

    return Order::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $customer->getKey(),
        'sales_channel_id' => $channel->getKey(),
        'branch_id' => $test->branchId,
        'status' => $status,
        'currency_code' => $currency,
        'subtotal_minor' => $totalMinor,
        'delivery_fee_minor' => 0,
        'total_minor' => $totalMinor,
        'confirmed_at' => $confirmedAt,
        'cancelled_at' => $status === OrderStatus::Cancelled ? now() : null,
    ]);
}

function reportLine(Order $order, CatalogueItem $item, int $lineTotalMinor): void
{
    OrderLine::factory()->create([
        'order_id' => $order->getKey(),
        'catalogue_item_id' => $item->getKey(),
        'quantity' => '1.0000',
        'unit_price_minor' => $lineTotalMinor,
        'line_total_minor' => $lineTotalMinor,
    ]);
}

/** A consume movement valued at COGS, referencing an order, stamped in a given month. */
function reportConsume(object $test, Order $order, ?string $cost, string $createdAt, ?string $currency = 'USD'): void
{
    StockMovement::withoutTimestamps(fn () => StockMovement::query()->create([
        'organisation_id' => $test->orgId,
        'branch_id' => $test->branchId,
        'stock_item_id' => $test->stockItemId,
        'quantity_delta' => '-1.0000',
        'reason' => 'consume',
        'reference_type' => 'order',
        'reference_id' => (string) $order->getKey(),
        'unit_cost_amount' => $cost,
        'cost_amount' => $cost,
        'cost_currency_code' => $cost === null ? null : $currency,
        'created_at' => $createdAt,
        'updated_at' => $createdAt,
    ]));
}

/** A waste movement, optionally valued, stamped in a given month. */
function reportWaste(object $test, string $quantity, ?string $cost, string $createdAt, string $currency = 'USD'): void
{
    StockMovement::withoutTimestamps(fn () => StockMovement::query()->create([
        'organisation_id' => $test->orgId,
        'branch_id' => $test->branchId,
        'stock_item_id' => $test->stockItemId,
        'quantity_delta' => '-'.$quantity,
        'reason' => 'waste',
        'reference_type' => null,
        'reference_id' => null,
        'unit_cost_amount' => $cost,
        'cost_amount' => $cost,
        'cost_currency_code' => $cost === null ? null : $currency,
        'created_at' => $createdAt,
        'updated_at' => $createdAt,
    ]));
}

/** A priced goods-receipt line, received in a given month. */
function reportReceiptLine(object $test, string $lineTotal, string $currency, string $receivedAt): void
{
    $receipt = GoodsReceipt::query()->create([
        'organisation_id' => $test->orgId,
        'branch_id' => $test->branchId,
        'received_at' => $receivedAt,
    ]);

    GoodsReceiptLine::query()->create([
        'goods_receipt_id' => $receipt->getKey(),
        'stock_item_id' => $test->stockItemId,
        'quantity' => '1.0000',
        'line_total_amount' => $lineTotal,
        'cost_currency_code' => $currency,
    ]);
}

function reportException(object $test, Order $order): void
{
    OrderConsumptionException::query()->create([
        'organisation_id' => $test->orgId,
        'order_id' => (string) $order->getKey(),
        'reason_code' => 'no_ingredient_cost',
    ]);
}

/**
 * @param  list<array<string, mixed>>  $rows
 * @return array<string, mixed>|null
 */
function rowFor(array $rows, string $month, string $currency): ?array
{
    foreach ($rows as $row) {
        if ($row['month'] === $month && $row['currency_code'] === $currency) {
            return $row;
        }
    }

    return null;
}

it('rolls spend, COGS, revenue, waste and margin per month and currency', function (): void {
    // July: one receipt, one confirmed order and its consume — a clean month.
    reportReceiptLine($this, '80.000000', 'USD', '2026-07-03 09:00:00');
    $july = reportOrder($this, OrderStatus::Confirmed, 20000, '2026-07-15 12:00:00');
    reportLine($july, $this->meal, 20000);
    reportConsume($this, $july, '30.000000', '2026-07-15 12:05:00');

    $rows = $this->service->forOrganisation($this->orgId);

    $row = rowFor($rows, '2026-07', 'USD');
    expect($row)->not->toBeNull();
    expect($row['spend_amount'])->toBe('80.000000')
        ->and($row['cogs_amount'])->toBe('30.000000')
        // 20000 minor ÷ 10^2 → 200 major.
        ->and($row['revenue_amount'])->toBe('200.000000')
        // revenue − COGS.
        ->and($row['gross_margin_amount'])->toBe('170.000000')
        ->and($row['gross_margin_percent'])->toBe('85.00')
        ->and($row['has_data_quality_flag'])->toBeFalse()
        ->and($row['exception_count'])->toBe(0);
});

it('excludes a cancelled order from COGS and from revenue', function (): void {
    // Two live orders and one cancelled, all confirmed in August. The cancelled
    // order's consume still sits in the append-only ledger with its cost, and its
    // total is a real number on the orders table — both must be left out.
    $live1 = reportOrder($this, OrderStatus::Confirmed, 30000, '2026-08-10 12:00:00');
    $live2 = reportOrder($this, OrderStatus::Fulfilled, 10000, '2026-08-11 12:00:00');
    $cancelled = reportOrder($this, OrderStatus::Cancelled, 99999, '2026-08-10 12:00:00');

    reportConsume($this, $live1, '40.000000', '2026-08-12 12:00:00');
    reportConsume($this, $live2, '20.000000', '2026-08-12 12:00:00');
    reportConsume($this, $cancelled, '999.000000', '2026-08-12 12:00:00');

    $rows = $this->service->forOrganisation($this->orgId);
    $row = rowFor($rows, '2026-08', 'USD');

    expect($row)->not->toBeNull();
    // 40 + 20, never 40 + 20 + 999.
    expect($row['cogs_amount'])->toBe('60.000000')
        // (30000 + 10000) ÷ 100, never the cancelled 99999.
        ->and($row['revenue_amount'])->toBe('400.000000')
        ->and($row['gross_margin_amount'])->toBe('340.000000');
});

it('never sums figures across currencies', function (): void {
    // Two receipts in the same month, one USD and one EUR. They must land on two
    // separate rows — there is no exchange rate to add them with.
    reportReceiptLine($this, '150.000000', 'USD', '2026-08-05 09:00:00');
    reportReceiptLine($this, '200.000000', 'EUR', '2026-08-06 09:00:00');

    $rows = $this->service->forOrganisation($this->orgId);

    $usd = rowFor($rows, '2026-08', 'USD');
    $eur = rowFor($rows, '2026-08', 'EUR');

    expect($usd)->not->toBeNull()
        ->and($eur)->not->toBeNull();
    expect($usd['spend_amount'])->toBe('150.000000')
        ->and($eur['spend_amount'])->toBe('200.000000');
});

it('splits revenue into meal and product from the order lines', function (): void {
    $order = reportOrder($this, OrderStatus::Confirmed, 40000, '2026-08-10 12:00:00');
    reportLine($order, $this->meal, 30000);
    reportLine($order, $this->product, 10000);

    $rows = $this->service->forOrganisation($this->orgId);
    $row = rowFor($rows, '2026-08', 'USD');

    expect($row)->not->toBeNull();
    expect($row['meal_revenue_amount'])->toBe('300.000000')
        ->and($row['product_revenue_amount'])->toBe('100.000000')
        ->and($row['other_revenue_amount'])->toBe('0.000000');
});

it('flags a month whose COGS is understated by unresolved exceptions, and not a clean month', function (): void {
    // August has an exception on a live order (understated) and one on a cancelled
    // order (irrelevant — that COGS is out anyway). July is clean.
    $august = reportOrder($this, OrderStatus::Confirmed, 30000, '2026-08-10 12:00:00');
    $cancelled = reportOrder($this, OrderStatus::Cancelled, 5000, '2026-08-10 12:00:00');
    $july = reportOrder($this, OrderStatus::Confirmed, 20000, '2026-07-10 12:00:00');

    reportException($this, $august);
    reportException($this, $cancelled);

    $rows = $this->service->forOrganisation($this->orgId);

    $augustRow = rowFor($rows, '2026-08', 'USD');
    $julyRow = rowFor($rows, '2026-07', 'USD');

    expect($augustRow['has_data_quality_flag'])->toBeTrue()
        // Only the live order's exception counts; the cancelled one does not.
        ->and($augustRow['exception_count'])->toBe(1)
        ->and($julyRow['has_data_quality_flag'])->toBeFalse()
        ->and($julyRow['exception_count'])->toBe(0);
});

it('reports waste value when priced and the wasted quantity as the note otherwise', function (): void {
    reportWaste($this, '3.000000', '5.000000', '2026-08-04 09:00:00');
    reportWaste($this, '2.000000', null, '2026-08-05 09:00:00');

    $rows = $this->service->forOrganisation($this->orgId);
    $row = rowFor($rows, '2026-08', 'USD');

    expect($row)->not->toBeNull();
    // Only the priced waste contributes value; both contribute quantity. Waste
    // value is money (six places); the quantity note is a stock figure (four).
    expect($row['waste_amount'])->toBe('5.000000')
        ->and($row['waste_quantity'])->toBe('5.0000');
});

it('bounds the report to an inclusive month range', function (): void {
    reportReceiptLine($this, '10.000000', 'USD', '2026-06-15 09:00:00');
    reportReceiptLine($this, '20.000000', 'USD', '2026-07-15 09:00:00');
    reportReceiptLine($this, '30.000000', 'USD', '2026-08-15 09:00:00');

    $rows = $this->service->forOrganisation($this->orgId, '2026-07', '2026-07');

    expect($rows)->toHaveCount(1);
    expect($rows[0]['month'])->toBe('2026-07')
        ->and($rows[0]['spend_amount'])->toBe('20.000000');
});
