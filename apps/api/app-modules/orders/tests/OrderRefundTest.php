<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Orders\Models\OrderRefund;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| Refunds and receipt corrections
|--------------------------------------------------------------------------
|
| A ledger beside the receipts, capped by them. The tests hold the owner's four
| rules: seven days, a reason, the $50 limit, and never more than arrived.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->world = RunWorld::build('refunds@kitchen.test');
    $this->actingAs($this->world->tenant->user);
});

function paidOrder(object $test, int $totalMinor = 10000): Order
{
    $order = RunWorld::order($test->world, ['status' => OrderStatus::Fulfilled, 'total_minor' => $totalMinor]);

    OrderPaymentReceipt::factory()->create([
        'organisation_id' => $order->organisation_id,
        'order_id' => $order->getKey(),
        'amount_minor' => $totalMinor,
        'currency_code' => $order->currency_code,
        'confirmed_by' => $test->world->tenant->user->getKey(),
        'confirmed_at' => now(),
    ]);

    return $order;
}

/**
 * @param  array<string, mixed>  $body
 */
function refund(object $test, Order $order, array $body = []): TestResponse
{
    return $test->postJson(
        '/api/v1/catalogue/orders/'.$order->getKey().'/refunds',
        ['kind' => 'refund', 'method' => 'cash_on_delivery', 'amount_minor' => 2000, 'reason' => 'Cold on arrival', ...$body],
        $test->world->headers + ['Idempotency-Key' => (string) Str::uuid()],
    );
}

it('refunds in part, keeps the receipt, and leaves the order paid', function (): void {
    $order = paidOrder($this);
    $receipt = OrderPaymentReceipt::query()->where('order_id', $order->getKey())->sole();

    refund($this, $order)
        ->assertCreated()
        ->assertJsonPath('data.refunded_minor', 2000)
        ->assertJsonPath('data.refundable_minor', 8000)
        ->assertJsonPath('data.entries.0.status', 'completed');

    expect($receipt->fresh()->amount_minor)->toBe(10000)
        ->and($order->fresh()->receivedMinor())->toBe(10000)
        ->and(AuditLog::query()->where('action', 'order.refund_completed')->where('subject_id', $order->getKey())->exists())->toBeTrue();
});

it('needs a reason', function (): void {
    refund($this, paidOrder($this), ['reason' => ''])->assertUnprocessable();
});

it('refuses more than the receipts say arrived, across entries', function (): void {
    $order = paidOrder($this, 4000);

    refund($this, $order, ['amount_minor' => 3000])->assertCreated();
    refund($this, $order, ['amount_minor' => 1001])
        ->assertConflict()
        ->assertJsonPath('error.code', 'payment.refund_exceeds_capture');
});

it('refuses an order with no receipts', function (): void {
    refund($this, RunWorld::order($this->world))->assertConflict();
});

it('closes seven days after the latest receipt', function (): void {
    $order = paidOrder($this);

    $this->travel(7)->days();
    $this->travel(1)->minutes();

    refund($this, $order)->assertConflict()->assertJsonPath('error.code', 'resource.conflict');
});

it('reads the window from the latest receipt, so a balance reopens it', function (): void {
    $order = paidOrder($this);

    $this->travel(6)->days();

    OrderPaymentReceipt::factory()->create([
        'organisation_id' => $order->organisation_id,
        'order_id' => $order->getKey(),
        'amount_minor' => 100,
        'currency_code' => $order->currency_code,
        'confirmed_by' => $this->world->tenant->user->getKey(),
        'confirmed_at' => now(),
    ]);

    $this->travel(6)->days();

    refund($this, $order)->assertCreated();
});

it('waits for the owner above the limit, and tells them on the bell', function (): void {
    $order = paidOrder($this);

    refund($this, $order, ['amount_minor' => 5001])
        ->assertCreated()
        ->assertJsonPath('data.entries.0.status', 'pending_approval')
        ->assertJsonPath('data.pending_minor', 5001)
        ->assertJsonPath('data.refundable_minor', 4999);

    expect(StaffNotification::withoutTenancy()
        ->where('user_id', $this->world->ownerAlerted->getKey())
        ->where('type', StaffAlertType::RefundApproval->value)
        ->where('subject_id', $order->getKey())
        ->exists())->toBeTrue();
});

it('counts earlier refunds toward the limit, so it cannot be walked past', function (): void {
    $order = paidOrder($this);

    refund($this, $order, ['amount_minor' => 4000])->assertJsonPath('data.entries.0.status', 'completed');
    refund($this, $order, ['amount_minor' => 4000])->assertJsonPath('data.entries.0.status', 'pending_approval');
});

it('reads the limit from the kitchen setting', function (): void {
    $order = paidOrder($this);

    $settings = app(KitchenServiceSettingsLookup::class)->for($order->organisation_id);
    $settings->refund_approval_above_minor = 500;
    $settings->save();

    refund($this, $order, ['amount_minor' => 501])->assertJsonPath('data.entries.0.status', 'pending_approval');
});

it('needs no approval from an owner refunding themselves', function (): void {
    RunWorld::grant($this->world, ['order.approve_refund_organisation']);

    refund($this, paidOrder($this), ['amount_minor' => 9000])
        ->assertJsonPath('data.entries.0.status', 'completed');
});

it('lets the owner approve what waited, once', function (): void {
    $order = paidOrder($this);
    $entryId = refund($this, $order, ['amount_minor' => 6000])->json('data.entries.0.id');
    $url = '/api/v1/catalogue/orders/'.$order->getKey().'/refunds/'.$entryId;

    $this->postJson($url.'/approve', [], $this->world->headers)->assertForbidden();

    RunWorld::grant($this->world, ['order.approve_refund_organisation']);

    $this->postJson($url.'/approve', [], $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.refunded_minor', 6000)
        ->assertJsonPath('data.pending_minor', 0);

    $this->postJson($url.'/reject', [], $this->world->headers)->assertConflict();
});

it('frees the cap when the owner rejects', function (): void {
    $order = paidOrder($this);
    $entryId = refund($this, $order, ['amount_minor' => 6000])->json('data.entries.0.id');

    RunWorld::grant($this->world, ['order.approve_refund_organisation']);

    $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/refunds/'.$entryId.'/reject', [], $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.entries.0.status', 'rejected')
        ->assertJsonPath('data.refundable_minor', 10000);
});

it('gives the balance back when a receipt was a mistake', function (): void {
    $order = paidOrder($this);

    refund($this, $order, ['kind' => 'receipt_correction', 'amount_minor' => 3000])
        ->assertCreated()
        ->assertJsonPath('data.corrected_minor', 3000);

    expect($order->fresh()->receivedMinor())->toBe(7000);
});

it('caps refunds and corrections together', function (): void {
    $order = paidOrder($this, 4000);

    refund($this, $order, ['kind' => 'receipt_correction', 'amount_minor' => 3000])->assertCreated();
    refund($this, $order, ['amount_minor' => 1001])->assertConflict();
});

it('is closed to a member without the manager code', function (): void {
    $this->world = RunWorld::build('desk@kitchen.test', ['order.view_organisation', 'order.manage_organisation']);
    $this->actingAs($this->world->tenant->user);

    refund($this, paidOrder($this))->assertForbidden();
});

it('refuses to change or delete a decided entry at the database', function (): void {
    $order = paidOrder($this);
    $entryId = refund($this, $order)->json('data.entries.0.id');

    expect(fn () => DB::transaction(fn () => OrderRefund::query()->whereKey($entryId)->update(['amount_minor' => 1])))
        ->toThrow(QueryException::class, 'append-only')
        ->and(fn () => DB::transaction(fn () => OrderRefund::query()->whereKey($entryId)->delete()))
        ->toThrow(QueryException::class, 'append-only');
});
