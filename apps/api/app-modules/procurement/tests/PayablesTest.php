<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\ReceiptPriceCompletionService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\Mail;

/*
|--------------------------------------------------------------------------
| Purchase price control and payables
|--------------------------------------------------------------------------
|
| Receiving is never stopped: a price over the limit holds the payment, not the
| goods. The tests hold that line, the comparison rules, and the first list not
| claiming the kitchen owes for everything it ever bought.
|
*/

const PAYABLES_URL = '/api/v1/catalogue/procurement/payables';

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();
    $this->travelTo('2026-11-20 12:00:00');

    $this->tenant = PricingWorld::kitchen('payables@kitchen.test', ['inventory.view_costs_organisation', 'inventory.approve_payables_organisation']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->headers = PricingWorld::headers($this->tenant);
    $this->actingAs($this->tenant->user);

    app(TenantContext::class)->setOrganisation((string) $this->tenant->user->getKey(), $this->orgId);

    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->orgId,
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->supplier = Supplier::query()->create(['code' => 'sup-1', 'name_en' => 'Gulf Fresh', 'payment_due_days' => 30]);
    $this->item = StockItem::query()->create([
        'organisation_id' => $this->orgId,
        'code' => 'sku-oil',
        'name_en' => 'Olive oil',
        'unit_code' => 'kg',
    ]);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

function delivery(object $test, ?string $price, string $receivedOn, ?string $currency = 'USD', bool $supplier = true): GoodsReceipt
{
    return app(GoodsReceiptService::class)->post(
        $test->orgId,
        (string) $test->branch->getKey(),
        $supplier ? (string) $test->supplier->getKey() : null,
        null,
        null,
        [[
            'stock_item_id' => (string) $test->item->getKey(),
            'quantity' => '2',
            'unit_price_amount' => $price,
            'cost_currency_code' => $price === null ? null : $currency,
        ]],
        receivedOn: $receivedOn,
    );
}

function priceLimit(object $test, int $percent): void
{
    $settings = app(KitchenServiceSettingsLookup::class)->for($test->orgId);
    $settings->price_approval_above_percent = $percent;
    $settings->save();
}

it('compares a delivery with the last price, and works out the due date', function (): void {
    delivery($this, '10.00', '2026-11-01');
    $receipt = delivery($this, '12.50', '2026-11-02');

    $line = $receipt->lines()->sole();

    expect($line->last_unit_price_amount)->toBe('10.000000')
        ->and($line->price_variance_percent)->toBe('25.00')
        ->and($receipt->fresh()->due_on?->toDateString())->toBe('2026-12-02');
});

it('leaves the variance empty for a first purchase and across currencies', function (): void {
    expect(delivery($this, '10.00', '2026-11-01')->lines()->sole()->price_variance_percent)->toBeNull()
        ->and(delivery($this, '11.00', '2026-11-02', 'EUR')->lines()->sole()->price_variance_percent)->toBeNull();
});

it('holds the payment and not the goods when a price rises past the limit', function (): void {
    priceLimit($this, 10);
    delivery($this, '10.00', '2026-11-01');
    $receipt = delivery($this, '12.00', '2026-11-02');

    expect($receipt->fresh()->price_approval_status)->toBe('pending')
        ->and(StaffNotification::withoutTenancy()->where('type', StaffAlertType::PriceApproval->value)->where('subject_id', $receipt->getKey())->exists())->toBeTrue();

    $this->postJson(PAYABLES_URL."/{$receipt->getKey()}/pay", [], $this->headers)->assertConflict();
    $this->postJson(PAYABLES_URL."/{$receipt->getKey()}/approve-price", [], $this->headers)->assertOk();
    $this->postJson(PAYABLES_URL."/{$receipt->getKey()}/approve-price", [], $this->headers)->assertConflict();
    $this->postJson(PAYABLES_URL."/{$receipt->getKey()}/pay", ['reference' => 'TRF-1'], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.paid.0.paid_reference', 'TRF-1');
    $this->postJson(PAYABLES_URL."/{$receipt->getKey()}/pay", [], $this->headers)->assertConflict();
});

it('needs no approval for a fall, or with no limit set', function (): void {
    delivery($this, '10.00', '2026-11-01');
    $rise = delivery($this, '50.00', '2026-11-02');

    priceLimit($this, 10);
    $fall = delivery($this, '5.00', '2026-11-03');

    expect($rise->fresh()->price_approval_status)->toBeNull()
        ->and($fall->fresh()->price_approval_status)->toBeNull();
});

it('reviews a price entered late, against the deliveries before it', function (): void {
    priceLimit($this, 10);
    delivery($this, '10.00', '2026-11-01');
    $late = delivery($this, null, '2026-11-02');
    delivery($this, '30.00', '2026-11-03');

    app(ReceiptPriceCompletionService::class)->complete($late, [[
        'goods_receipt_line_id' => (string) $late->lines()->sole()->getKey(),
        'unit_price_amount' => '15.00',
        'cost_currency_code' => 'USD',
    ]]);

    expect($late->lines()->sole()->price_variance_percent)->toBe('50.00')
        ->and($late->fresh()->price_approval_status)->toBe('pending');
});

it('lists what is owed, refuses to pay an unpriced delivery, and leaves the old and the direct out', function (): void {
    GoodsReceipt::query()->create([
        'organisation_id' => $this->orgId,
        'branch_id' => $this->branch->getKey(),
        'supplier_id' => $this->supplier->getKey(),
        'received_at' => now(),
        'received_on' => '2026-10-01',
        'cost_status' => 'complete',
        'payment_status' => 'not_tracked',
    ]);
    delivery($this, '10.00', '2026-11-01', supplier: false);
    $owed = delivery($this, '10.00', '2026-11-02');
    $unpriced = delivery($this, null, '2026-11-03');

    $this->getJson(PAYABLES_URL, $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data.unpaid')
        ->assertJsonPath('data.unpaid.0.id', (string) $owed->getKey())
        ->assertJsonPath('data.unpaid.0.amount', '20.000000')
        ->assertJsonPath('data.totals.0.amount', '20.000000')
        ->assertJsonPath('data.unpaid.1.amount', null);

    $this->postJson(PAYABLES_URL."/{$unpriced->getKey()}/pay", [], $this->headers)->assertConflict();
});

it('flags an overdue delivery on the kitchen clock, and lets a due date be moved', function (): void {
    $this->travelTo('2026-12-10 12:00:00');
    $receipt = delivery($this, '10.00', '2026-11-02');

    $this->getJson(PAYABLES_URL, $this->headers)->assertJsonPath('data.unpaid.0.is_overdue', true);

    $this->putJson(PAYABLES_URL."/{$receipt->getKey()}/due-date", ['due_on' => '2026-12-20'], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.unpaid.0.is_overdue', false);
});

it('is closed to a member without the cost code, and the acts to one without the approve code', function (): void {
    $receipt = delivery($this, '10.00', '2026-11-02');

    $reader = PricingWorld::kitchen('reader@kitchen.test', ['inventory.view_costs_organisation']);
    forgetResolvedGuards();
    $this->actingAs($reader->user);
    $this->postJson(PAYABLES_URL."/{$receipt->getKey()}/pay", [], PricingWorld::headers($reader))->assertForbidden();

    $nobody = PricingWorld::kitchen('nobody@kitchen.test', ['order.view_organisation']);
    forgetResolvedGuards();
    $this->actingAs($nobody->user);
    $this->getJson(PAYABLES_URL, PricingWorld::headers($nobody))->assertForbidden();
});
