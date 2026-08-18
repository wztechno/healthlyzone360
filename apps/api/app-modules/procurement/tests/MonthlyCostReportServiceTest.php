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
| SUP6 moved the purchasing side onto the shared `ProcurementSpendQuery` (§3.7)
| so the report and the weekly/monthly summary cannot disagree. Every figure here
| is unchanged by that, which is the point of the tests above staying as they
| were; the three tests at the foot of this file pin what it *did* change — the
| bucket is now the receipt's branch-local business date, and a month whose
| deliveries are not fully priced says so.
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

/**
 * A consume movement valued at COGS, referencing an order, stamped in a given
 * month. `soldItemType` attributes it to a line of business for the COGS split
 * (INV1.5); left null it stands for a consume predating that attribution.
 */
function reportConsume(object $test, Order $order, ?string $cost, string $createdAt, ?string $currency = 'USD', ?string $soldItemType = null): void
{
    StockMovement::withoutTimestamps(fn () => StockMovement::query()->create([
        'organisation_id' => $test->orgId,
        'branch_id' => $test->branchId,
        'stock_item_id' => $test->stockItemId,
        'quantity_delta' => '-1.0000',
        'reason' => 'consume',
        'reference_type' => 'order',
        'reference_id' => (string) $order->getKey(),
        'sold_item_type' => $soldItemType,
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

/**
 * A priced goods-receipt line, received in a given month.
 *
 * `received_on` is the branch-local business date SUP5 added and SUP6 groups
 * spend by; `received_at` stays the instant. The two are kept consistent here —
 * the day of the instant — exactly as `GoodsReceiptService` keeps them, so this
 * fixture cannot express a receipt the real posting path could not produce.
 *
 * `costedAt` is what tells the report whether a month's spend is finished. It
 * defaults to the receipt instant, which is what the posting path stamps for a
 * priced line; pass `null` for a line whose invoice has not arrived, and no
 * `lineTotal` with it — money and settlement arrive together.
 */
function reportReceiptLine(
    object $test,
    ?string $lineTotal,
    ?string $currency,
    string $receivedAt,
    ?string $receivedOn = null,
    ?string $costedAt = null,
    bool $valuationPendingFx = false,
): void {
    $receipt = GoodsReceipt::query()->create([
        'organisation_id' => $test->orgId,
        'branch_id' => $test->branchId,
        'received_at' => $receivedAt,
        'received_on' => $receivedOn ?? substr($receivedAt, 0, 10),
        'cost_status' => $lineTotal === null ? 'unpriced' : 'complete',
    ]);

    GoodsReceiptLine::query()->create([
        'goods_receipt_id' => $receipt->getKey(),
        'stock_item_id' => $test->stockItemId,
        'quantity' => '1.0000',
        'line_total_amount' => $lineTotal,
        'cost_currency_code' => $currency,
        'costed_at' => $lineTotal === null || $valuationPendingFx ? $costedAt : ($costedAt ?? $receivedAt),
        'valuation_pending_fx' => $valuationPendingFx,
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

it('splits COGS into meal, product and other from the consume movements', function (): void {
    // One confirmed August order whose consumes attribute per line of business:
    // a meal's exploded recipe cost, a product's own moving-average cost, and one
    // legacy consume with no attribution that must fall into `other` so the three
    // still reconcile to the month's total COGS.
    $order = reportOrder($this, OrderStatus::Confirmed, 50000, '2026-08-10 12:00:00');
    reportConsume($this, $order, '40.000000', '2026-08-10 12:05:00', soldItemType: 'meal');
    reportConsume($this, $order, '15.000000', '2026-08-10 12:05:00', soldItemType: 'product');
    reportConsume($this, $order, '5.000000', '2026-08-10 12:05:00', soldItemType: null);

    $rows = $this->service->forOrganisation($this->orgId);
    $row = rowFor($rows, '2026-08', 'USD');

    expect($row)->not->toBeNull();
    expect($row['meal_cogs_amount'])->toBe('40.000000')
        ->and($row['product_cogs_amount'])->toBe('15.000000')
        ->and($row['other_cogs_amount'])->toBe('5.000000')
        // The three buckets reconcile to the unsplit total.
        ->and($row['cogs_amount'])->toBe('60.000000');
});

it('excludes a cancelled order from the COGS split, as from the total', function (): void {
    $live = reportOrder($this, OrderStatus::Confirmed, 30000, '2026-08-10 12:00:00');
    $cancelled = reportOrder($this, OrderStatus::Cancelled, 99999, '2026-08-10 12:00:00');

    reportConsume($this, $live, '20.000000', '2026-08-10 12:05:00', soldItemType: 'meal');
    reportConsume($this, $cancelled, '999.000000', '2026-08-10 12:05:00', soldItemType: 'meal');

    $rows = $this->service->forOrganisation($this->orgId);
    $row = rowFor($rows, '2026-08', 'USD');

    expect($row)->not->toBeNull();
    // Only the live order's meal COGS, never the cancelled 999.
    expect($row['meal_cogs_amount'])->toBe('20.000000')
        ->and($row['cogs_amount'])->toBe('20.000000');
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

/* ── what the shared aggregation changed (SUP6) ──────────────────────────── */

it('files spend under the receipt business date rather than the instant', function (): void {
    // A delivery whose branch-local day is the last of July and whose UTC
    // instant has already tipped into August — the exact case SUP5 added
    // `received_on` for, and the one place this refactor moves a figure.
    reportReceiptLine($this, '40.000000', 'USD', '2026-08-01 02:00:00', receivedOn: '2026-07-31');

    $rows = $this->service->forOrganisation($this->orgId);

    expect(rowFor($rows, '2026-08', 'USD'))->toBeNull();
    expect(rowFor($rows, '2026-07', 'USD')['spend_amount'])->toBe('40.000000');
});

it('flags a month whose spend is understated by a delivery nobody has priced yet', function (): void {
    reportReceiptLine($this, '80.000000', 'USD', '2026-07-03 09:00:00');
    // The goods are on the shelf and the invoice is in the post (§3.6).
    reportReceiptLine($this, null, null, '2026-07-04 09:00:00');
    reportReceiptLine($this, '20.000000', 'USD', '2026-06-03 09:00:00');

    $rows = $this->service->forOrganisation($this->orgId);
    $july = rowFor($rows, '2026-07', 'USD');
    $june = rowFor($rows, '2026-06', 'USD');

    expect($july['spend_amount'])->toBe('80.000000')
        ->and($july['is_spend_complete'])->toBeFalse()
        ->and($july['unpriced_line_count'])->toBe(1)
        ->and($july['valuation_pending_line_count'])->toBe(0)
        // A different figure fails for a different reason: the COGS flag is
        // untouched by an unpriced receipt, and merging the two would leave a
        // reader unable to tell which number to distrust.
        ->and($july['has_data_quality_flag'])->toBeFalse()
        ->and($june['is_spend_complete'])->toBeTrue()
        ->and($june['unpriced_line_count'])->toBe(0);
});

it('counts a price waiting on an exchange rate as spend, and still calls the month incomplete', function (): void {
    // The supplier's price is recorded exactly as written; what is outstanding
    // is the kitchen's valuation of it, and no rate is ever invented (§3.6).
    reportReceiptLine($this, '60.000000', 'EUR', '2026-08-03 09:00:00', valuationPendingFx: true);

    $row = rowFor($this->service->forOrganisation($this->orgId), '2026-08', 'EUR');

    expect($row['spend_amount'])->toBe('60.000000')
        ->and($row['is_spend_complete'])->toBeFalse()
        ->and($row['unpriced_line_count'])->toBe(0)
        ->and($row['valuation_pending_line_count'])->toBe(1);
});
