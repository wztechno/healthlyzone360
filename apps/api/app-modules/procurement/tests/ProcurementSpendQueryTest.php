<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\ProcurementSpendQuery;
use Healthy360\Procurement\Services\ReceiptPriceCompletionService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The one procurement-spend aggregation (SUP6) — §3.7
|--------------------------------------------------------------------------
|
| Every receipt below is posted through `GoodsReceiptService::post`, never
| inserted: §8 is explicit that tests create priced receipts through the real
| receipt path, and a fixture that wrote rows directly could not prove the
| summary reconciles to a ledger those rows never entered properly.
|
| The claims this file pins are the ones a screen cannot make for itself:
|
| - **the bucket is the branch-local business date.** A Sunday delivery and the
|   Monday after it are two ISO weeks; the last day of July and the first of
|   August are one week and two months.
| - **currencies never meet.** Two currencies in one period are two rows, and
|   there is no total anywhere that adds them.
| - **header charges are counted once**, off the receipt rather than off a line
|   join that would multiply them, and they are never folded into item spend.
| - **an unpriced line counts and buys nothing.** It has no currency, so it lives
|   on the period; the period is Incomplete until it is settled, and a line
|   waiting on an exchange rate is counted apart from one waiting on an invoice.
| - **the breakdowns cost one query each**, asserted by counting statements
|   rather than by reading the code.
| - **the summary reconciles exactly to the ledger** — §9's requirement, as a
|   test: Σ item subtotal per currency equals Σ line totals on the purchases
|   ledger for the same filters.
|
*/

/** The dates this file leans on, chosen for the boundaries they straddle. */
const SPEND_SUNDAY = '2026-07-26';          // ISO 2026-W30, month 2026-07

const SPEND_MONDAY = '2026-07-27';          // ISO 2026-W31, month 2026-07

const SPEND_MONTH_END = '2026-07-31';       // ISO 2026-W31, month 2026-07

const SPEND_MONTH_START = '2026-08-01';     // ISO 2026-W31, month 2026-08

const SPEND_EARLIER = '2026-06-15';         // well outside every asserted window

/**
 * A kitchen with two branches, two suppliers, an ingredient-backed shelf and a
 * shelf with nothing behind it, and a caller holding everything.
 */
function spendWorld(string $email): object
{
    $tenant = PricingWorld::kitchen($email, PricingWorld::FULL_PERMISSIONS);
    $organisation = $tenant->organisation;

    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'country_code' => $organisation->country_code,
    ]);
    $otherBranch = OrganisationBranch::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'country_code' => $organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation((string) $tenant->user->getKey(), (string) $organisation->getKey());

    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $supplier = Supplier::query()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'SUP-A',
        'name_en' => 'Gulf Fresh',
        'currency_code' => 'USD',
    ]);
    $otherSupplier = Supplier::query()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'SUP-B',
        'name_en' => 'Delta Dry Goods',
        'currency_code' => 'USD',
    ]);

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    $flour = StockItem::query()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'FLR-1',
        'name_en' => 'Flour',
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    // No ingredient behind it, so its money settles without ever touching a
    // moving average — the packaging case ReceiptLineCosting calls `settled`.
    $packaging = StockItem::query()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'PKG-1',
        'name_en' => 'Boxes',
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
    ]);

    app(TenantContext::class)->clear();

    return (object) [
        'tenant' => $tenant,
        'organisationId' => (string) $organisation->getKey(),
        'branchId' => (string) $branch->getKey(),
        'otherBranchId' => (string) $otherBranch->getKey(),
        'supplierId' => (string) $supplier->getKey(),
        'otherSupplierId' => (string) $otherSupplier->getKey(),
        'flourId' => (string) $flour->getKey(),
        'packagingId' => (string) $packaging->getKey(),
        'kgId' => (string) $kg->getKey(),
        'headers' => PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()],
    ];
}

/**
 * Post one delivery through the real service, inside the world's tenant context.
 *
 * @param  list<array<string, mixed>>  $lines
 * @param  array<string, mixed>  $extra
 */
function spendPost(object $world, string $receivedOn, array $lines, array $extra = []): GoodsReceipt
{
    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);

    try {
        return app(GoodsReceiptService::class)->post(
            $world->organisationId,
            $extra['branch_id'] ?? $world->branchId,
            array_key_exists('supplier_id', $extra) ? $extra['supplier_id'] : $world->supplierId,
            $extra['document_ref'] ?? 'DN-'.$receivedOn,
            null,
            $lines,
            receivedOn: $receivedOn,
            supplierInvoiceRef: $extra['supplier_invoice_ref'] ?? null,
            charges: $extra['charges'] ?? [],
        );
    } finally {
        app(TenantContext::class)->clear();
    }
}

/**
 * One priced line of `$quantity` at `$price`, quoted in kilograms.
 *
 * @return array<string, mixed>
 */
function spendLine(object $world, string $stockItemId, string $quantity, ?string $price, string $currency = 'USD'): array
{
    $line = [
        'stock_item_id' => $stockItemId,
        'quantity' => $quantity,
        'unit_id' => $world->kgId,
    ];

    if ($price === null) {
        return $line;
    }

    return $line + ['unit_price_amount' => $price, 'cost_currency_code' => $currency];
}

/**
 * @param  list<string>  $include
 * @param  array<string, string|null>  $filters
 * @return list<array<string, mixed>>
 */
function spendSummary(object $world, string $groupBy, array $filters = [], array $include = [], ?string $from = null, ?string $to = null): array
{
    return app(ProcurementSpendQuery::class)->forOrganisation(
        $world->organisationId,
        $groupBy,
        $from,
        $to,
        $filters,
        $include,
    );
}

/**
 * @param  list<array<string, mixed>>  $periods
 * @return array<string, mixed>|null
 */
function spendPeriod(array $periods, string $label): ?array
{
    foreach ($periods as $period) {
        if ($period['period'] === $label) {
            return $period;
        }
    }

    return null;
}

/**
 * @param  array<string, mixed>  $period
 * @return array<string, mixed>|null
 */
function spendCurrency(array $period, string $currencyCode): ?array
{
    /** @var list<array<string, mixed>> $totals */
    $totals = $period['totals_by_currency'];

    foreach ($totals as $row) {
        if ($row['currency_code'] === $currencyCode) {
            return $row;
        }
    }

    return null;
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

/* ── bucketing ───────────────────────────────────────────────────────────── */

it('puts a Sunday delivery and the Monday after it in two ISO weeks and one month', function (): void {
    $world = spendWorld('iso-week@kitchen.test');

    spendPost($world, SPEND_SUNDAY, [spendLine($world, $world->flourId, '4', '1.25')]);
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->flourId, '10', '2.50')]);

    $weeks = spendSummary($world, ProcurementSpendQuery::WEEK);

    // ISO weeks start Monday, so the Sunday belongs to the week before.
    expect(spendCurrency(spendPeriod($weeks, '2026-W30') ?? [], 'USD')['item_subtotal'])->toBe('5.000000')
        ->and(spendCurrency(spendPeriod($weeks, '2026-W31') ?? [], 'USD')['item_subtotal'])->toBe('25.000000');

    $months = spendSummary($world, ProcurementSpendQuery::MONTH);

    // Both are July, and the month figure is the sum of the two weeks.
    expect($months)->toHaveCount(1);
    expect(spendCurrency($months[0], 'USD')['item_subtotal'])->toBe('30.000000')
        ->and($months[0]['period'])->toBe('2026-07')
        ->and($months[0]['period_start'])->toBe('2026-07-01')
        ->and($months[0]['period_end'])->toBe('2026-07-31');
});

it('puts a month boundary inside one ISO week without moving either month', function (): void {
    $world = spendWorld('month-boundary@kitchen.test');

    spendPost($world, SPEND_MONTH_END, [spendLine($world, $world->flourId, '2', '3.00')]);
    spendPost($world, SPEND_MONTH_START, [spendLine($world, $world->flourId, '4', '3.00')]);

    $weeks = spendSummary($world, ProcurementSpendQuery::WEEK);
    $week = spendPeriod($weeks, '2026-W31');

    // One week, both deliveries — 31 July is a Friday and 1 August the Saturday.
    expect($weeks)->toHaveCount(1);
    expect(spendCurrency($week ?? [], 'USD')['item_subtotal'])->toBe('18.000000')
        ->and($week['period_start'])->toBe('2026-07-27')
        ->and($week['period_end'])->toBe('2026-08-02');

    $months = spendSummary($world, ProcurementSpendQuery::MONTH);

    expect($months)->toHaveCount(2);
    expect(spendCurrency(spendPeriod($months, '2026-07') ?? [], 'USD')['item_subtotal'])->toBe('6.000000')
        ->and(spendCurrency(spendPeriod($months, '2026-08') ?? [], 'USD')['item_subtotal'])->toBe('12.000000');

    // Newest period first, matching the monthly cost report beside it.
    expect($months[0]['period'])->toBe('2026-08');
});

/* ── currencies never meet ───────────────────────────────────────────────── */

it('keeps two currencies in one period as two rows and sums neither into the other', function (): void {
    $world = spendWorld('two-currencies@kitchen.test');

    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->packagingId, '10', '2.00', 'USD')], ['document_ref' => 'DN-USD']);
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->packagingId, '10', '3.00', 'EUR')], ['document_ref' => 'DN-EUR']);

    $months = spendSummary($world, ProcurementSpendQuery::MONTH);
    $july = spendPeriod($months, '2026-07');

    expect($july['totals_by_currency'])->toHaveCount(2);
    expect(spendCurrency($july, 'EUR')['item_subtotal'])->toBe('30.000000')
        ->and(spendCurrency($july, 'USD')['item_subtotal'])->toBe('20.000000')
        // Sorted by code, so a mixed-currency period is stably ordered.
        ->and($july['totals_by_currency'][0]['currency_code'])->toBe('EUR');

    // Nothing anywhere in the envelope adds 20 and 30.
    expect($july)->not->toHaveKey('item_subtotal');
});

/* ── header charges ──────────────────────────────────────────────────────── */

it('aggregates the receipt charges once each and keeps them out of item spend', function (): void {
    $world = spendWorld('charges@kitchen.test');

    // Two lines on one receipt: the charges must be counted once, not twice.
    spendPost(
        $world,
        SPEND_MONDAY,
        [
            spendLine($world, $world->flourId, '5', '3.00'),
            spendLine($world, $world->packagingId, '5', '3.00'),
        ],
        [
            'charges' => [
                'discount_amount' => '2',
                'tax_amount' => '1.5',
                'delivery_amount' => '5',
                'other_charges_amount' => '0.5',
                // 30 − 2 + 1.5 + 5 + 0.5
                'invoice_total_amount' => '35',
            ],
        ],
    );

    $july = spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH), '2026-07');
    $usd = spendCurrency($july ?? [], 'USD');

    expect($usd['received_line_count'])->toBe(2)
        ->and($usd['receipt_count'])->toBe(1)
        // Item spend is the goods and nothing else — tax is not a purchase price.
        ->and($usd['item_subtotal'])->toBe('30.000000')
        ->and($usd['discount_total'])->toBe('2.000000')
        ->and($usd['tax_total'])->toBe('1.500000')
        ->and($usd['delivery_total'])->toBe('5.000000')
        ->and($usd['other_charges_total'])->toBe('0.500000')
        ->and($usd['invoice_total'])->toBe('35.000000')
        ->and($usd['invoiced_receipt_count'])->toBe(1);
});

it('reports no invoice total as unknown and an unrecorded charge as zero', function (): void {
    $world = spendWorld('no-invoice@kitchen.test');

    // A delivery note with prices on it and no invoice yet — the ordinary case.
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->packagingId, '5', '4.00')]);

    $usd = spendCurrency(spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH), '2026-07') ?? [], 'USD');

    // A delivery fee nobody wrote down is zero money; an absent invoice total is
    // an unknown, and saying zero would claim the supplier billed nothing.
    expect($usd['invoice_total'])->toBeNull()
        ->and($usd['invoiced_receipt_count'])->toBe(0)
        ->and($usd['delivery_total'])->toBe('0.000000')
        ->and($usd['item_subtotal'])->toBe('20.000000');
});

/* ── completeness ────────────────────────────────────────────────────────── */

it('counts an unpriced line without letting it buy anything, and marks the period incomplete', function (): void {
    $world = spendWorld('unpriced@kitchen.test');

    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->packagingId, '5', null)]);

    $july = spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH), '2026-07');

    // §3.7: an unpriced line contributes to quantity history and not to money.
    // It has no currency, so there is no money row at all — the period is
    // structurally Incomplete rather than a complete-looking zero.
    expect($july['totals_by_currency'])->toBe([])
        ->and($july['receipt_count'])->toBe(1)
        ->and($july['unpriced_receipt_count'])->toBe(1)
        ->and($july['unpriced_line_count'])->toBe(1)
        ->and($july['valuation_pending_line_count'])->toBe(0)
        ->and($july['is_complete'])->toBeFalse();
});

it('counts a priced line waiting on an exchange rate apart from an unpriced one, and still counts its money', function (): void {
    $world = spendWorld('pending-fx@kitchen.test');

    // The first purchase fixes the ingredient's valuation currency, well outside
    // the window the assertions read.
    spendPost($world, SPEND_EARLIER, [spendLine($world, $world->flourId, '10', '2.00', 'USD')]);

    // A euro invoice for the same shelf: the price is recorded exactly as
    // written, the blend is refused, and no rate is invented (§3.6).
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->flourId, '5', '3.00', 'EUR')]);

    $july = spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH), '2026-07');

    expect($july['unpriced_line_count'])->toBe(0)
        ->and($july['valuation_pending_line_count'])->toBe(1)
        ->and($july['unpriced_receipt_count'])->toBe(1)
        ->and($july['is_complete'])->toBeFalse()
        // The supplier really charged this, so it is spend even though the
        // kitchen could not value it.
        ->and(spendCurrency($july, 'EUR')['item_subtotal'])->toBe('15.000000');
});

it('turns a period complete once the missing prices are filled in', function (): void {
    $world = spendWorld('completion@kitchen.test');

    $receipt = spendPost($world, SPEND_MONDAY, [spendLine($world, $world->packagingId, '5', null)]);

    $before = spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH), '2026-07');
    expect($before['is_complete'])->toBeFalse();

    $lineId = (string) GoodsReceiptLine::query()->where('goods_receipt_id', $receipt->getKey())->sole()->getKey();

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    app(ReceiptPriceCompletionService::class)->complete($receipt, [[
        'goods_receipt_line_id' => $lineId,
        'unit_price_amount' => '4.00',
        'cost_currency_code' => 'USD',
    ]]);
    app(TenantContext::class)->clear();

    $after = spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH), '2026-07');

    expect($after['is_complete'])->toBeTrue()
        ->and($after['unpriced_line_count'])->toBe(0)
        ->and($after['unpriced_receipt_count'])->toBe(0)
        ->and(spendCurrency($after, 'USD')['item_subtotal'])->toBe('20.000000');
});

/* ── filters ─────────────────────────────────────────────────────────────── */

it('narrows by branch, supplier and stock item', function (): void {
    $world = spendWorld('filters@kitchen.test');

    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->flourId, '10', '1.00')], ['document_ref' => 'DN-A']);
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->packagingId, '10', '2.00')], ['document_ref' => 'DN-B']);
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->flourId, '10', '4.00')], [
        'document_ref' => 'DN-C',
        'supplier_id' => $world->otherSupplierId,
    ]);
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->flourId, '10', '8.00')], [
        'document_ref' => 'DN-D',
        'branch_id' => $world->otherBranchId,
    ]);

    $all = spendCurrency(spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH), '2026-07') ?? [], 'USD');
    expect($all['item_subtotal'])->toBe('150.000000');

    $branch = spendCurrency(
        spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH, ['branch_id' => $world->branchId]), '2026-07') ?? [],
        'USD',
    );
    expect($branch['item_subtotal'])->toBe('70.000000');

    $supplier = spendCurrency(
        spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH, ['supplier_id' => $world->otherSupplierId]), '2026-07') ?? [],
        'USD',
    );
    expect($supplier['item_subtotal'])->toBe('40.000000');

    $item = spendCurrency(
        spendPeriod(spendSummary($world, ProcurementSpendQuery::MONTH, ['stock_item_id' => $world->packagingId]), '2026-07') ?? [],
        'USD',
    );
    expect($item['item_subtotal'])->toBe('20.000000')
        ->and($item['received_line_count'])->toBe(1);
});

it('bounds the window to the requested dates', function (): void {
    $world = spendWorld('window@kitchen.test');

    spendPost($world, SPEND_EARLIER, [spendLine($world, $world->packagingId, '10', '1.00')]);
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->packagingId, '10', '2.00')]);

    $bounded = spendSummary($world, ProcurementSpendQuery::MONTH, [], [], '2026-07-01', '2026-07-31');

    expect($bounded)->toHaveCount(1);
    expect($bounded[0]['period'])->toBe('2026-07')
        ->and(spendCurrency($bounded[0], 'USD')['item_subtotal'])->toBe('20.000000');
});

/* ── the breakdowns, and what they cost ──────────────────────────────────── */

it('breaks a period down by supplier and by stock item, one query each', function (): void {
    $world = spendWorld('breakdowns@kitchen.test');

    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->flourId, '10', '1.00')], ['document_ref' => 'DN-A']);
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->packagingId, '10', '5.00')], [
        'document_ref' => 'DN-B',
        'supplier_id' => $world->otherSupplierId,
    ]);

    $statements = 0;
    DB::listen(function () use (&$statements): void {
        $statements++;
    });

    $plain = spendSummary($world, ProcurementSpendQuery::MONTH);
    // Line totals, header charges, completeness — and nothing per period.
    expect($statements)->toBe(3);

    $july = spendPeriod($plain, '2026-07');
    expect(spendCurrency($july, 'USD')['by_supplier'])->toBeNull()
        ->and(spendCurrency($july, 'USD')['by_stock_item'])->toBeNull();

    $statements = 0;
    $withBoth = spendSummary($world, ProcurementSpendQuery::MONTH, [], [
        ProcurementSpendQuery::INCLUDE_SUPPLIERS,
        ProcurementSpendQuery::INCLUDE_ITEMS,
    ]);
    // Exactly one more per breakdown, whatever the period or supplier count.
    expect($statements)->toBe(5);

    $usd = spendCurrency(spendPeriod($withBoth, '2026-07') ?? [], 'USD');

    // Largest spend first, so a manager reads what the money went on.
    expect($usd['by_supplier'])->toHaveCount(2)
        ->and($usd['by_supplier'][0]['supplier']['code'])->toBe('SUP-B')
        ->and($usd['by_supplier'][0]['item_subtotal'])->toBe('50.000000')
        ->and($usd['by_supplier'][1]['item_subtotal'])->toBe('10.000000')
        ->and($usd['by_stock_item'])->toHaveCount(2)
        ->and($usd['by_stock_item'][0]['item_code'])->toBe('PKG-1')
        ->and($usd['by_stock_item'][0]['item_subtotal'])->toBe('50.000000');

    // The breakdown reconciles to the currency row it sits inside.
    $breakdownTotal = array_reduce(
        $usd['by_stock_item'],
        static fn (string $carry, array $row): string => bcadd($carry, (string) $row['item_subtotal'], 6),
        '0',
    );
    expect($breakdownTotal)->toBe($usd['item_subtotal']);
});

/* ── the reconciliation §9 asks for ──────────────────────────────────────── */

it('reconciles exactly to the purchases ledger, per currency, under the same filters', function (): void {
    $world = spendWorld('reconcile@kitchen.test');

    spendPost($world, SPEND_SUNDAY, [spendLine($world, $world->flourId, '3', '1.10')], ['document_ref' => 'DN-1']);
    spendPost($world, SPEND_MONDAY, [
        spendLine($world, $world->flourId, '7', '2.30'),
        spendLine($world, $world->packagingId, '2', '4.05'),
    ], ['document_ref' => 'DN-2']);
    spendPost($world, SPEND_MONTH_START, [spendLine($world, $world->packagingId, '9', '0.35')], ['document_ref' => 'DN-3']);
    // An unpriced delivery in the same window: it must appear in neither sum,
    // and it must be why the period says Incomplete rather than why a figure is
    // quietly short.
    spendPost($world, SPEND_MONDAY, [spendLine($world, $world->packagingId, '5', null)], ['document_ref' => 'DN-4']);

    $this->actingAs($world->tenant->user);

    $ledger = $this->getJson(
        '/api/v1/catalogue/procurement/purchases-ledger?'.http_build_query(['supplier_id' => $world->supplierId, 'limit' => 100]),
        $world->headers,
    )->assertOk()->json('data.purchases');

    $ledgerTotal = array_reduce(
        $ledger,
        static fn (string $carry, array $line): string => $line['line_total_amount'] === null
            ? $carry
            : bcadd($carry, (string) $line['line_total_amount'], 6),
        '0',
    );

    $periods = spendSummary($world, ProcurementSpendQuery::WEEK, ['supplier_id' => $world->supplierId]);

    $summaryTotal = '0';
    $unpriced = 0;

    foreach ($periods as $period) {
        $unpriced += (int) $period['unpriced_line_count'];

        foreach ($period['totals_by_currency'] as $row) {
            expect($row['currency_code'])->toBe('USD');
            $summaryTotal = bcadd($summaryTotal, (string) $row['item_subtotal'], 6);
        }
    }

    // The summary is the ledger, added up. Not approximately.
    // 3×1.10 + 7×2.30 + 2×4.05 + 9×0.35 = 3.30 + 16.10 + 8.10 + 3.15.
    expect($summaryTotal)->toBe($ledgerTotal)
        ->and($summaryTotal)->toBe('30.650000')
        ->and($unpriced)->toBe(1);
});
