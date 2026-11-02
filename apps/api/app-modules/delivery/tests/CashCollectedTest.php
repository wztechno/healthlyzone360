<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Orders\Services\OrderPaymentReceipts;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| Cash is written down when somebody says they took it
|--------------------------------------------------------------------------
|
| The audit proved a delivery fulfilled from the display wrote a receipt for the
| whole total against whoever pressed the button, with no money in anybody's
| hand. So a delivery writes no receipt on its own, and the driver says how much
| they took. The double press is run for real: the second request reaches a job
| that is already closed, which is what the conditional `UPDATE` turns into one
| receipt.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->world = RunWorld::build('cash@kitchen.test');
    $this->driverId = (string) $this->world->tenant->user->getKey();
    $this->actingAs($this->world->tenant->user);
});

/**
 * @param  array<string, mixed>  $body
 */
function deliverCash(object $test, DeliveryJob $job, array $body = []): TestResponse
{
    return $test->postJson("/api/v1/driver/jobs/{$job->getKey()}/deliver", $body, $test->world->headers);
}

/**
 * @return int the receipts against the order, summed
 */
function receiptedOn(Order $order): int
{
    return (int) OrderPaymentReceipt::query()->where('order_id', $order->getKey())->sum('amount_minor');
}

it('writes no receipt when a delivery is fulfilled from the kitchen', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);
    RunWorld::job($this->world, $order);

    $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/fulfil', [], $this->world->headers + [
        'If-Match' => '"'.$order->lock_version.'"',
    ])->assertOk()->assertJsonPath('data.order.status', 'fulfilled');

    expect(receiptedOn($order))->toBe(0);
});

it('writes one receipt to the driver for the full amount', function (): void {
    $order = RunWorld::order($this->world);
    $job = RunWorld::inTransit($this->world, $order);

    deliverCash($this, $job, ['collected_minor' => 3000])
        ->assertOk()
        ->assertJsonPath('data.job.status', 'delivered');

    $receipt = OrderPaymentReceipt::query()->where('order_id', $order->getKey())->sole();

    expect($receipt->amount_minor)->toBe(3000)
        ->and($receipt->confirmed_by)->toBe($this->driverId)
        ->and($receipt->method)->toBe(PaymentMethod::CashOnDelivery)
        ->and($order->refresh()->status)->toBe(OrderStatus::Fulfilled)
        ->and(AuditLog::query()->where('action', 'order.payment_recorded')->where('actor_user_id', $this->driverId)->count())->toBe(1);
});

it('leaves the rest outstanding when the driver came back short', function (): void {
    $order = RunWorld::order($this->world);
    $job = RunWorld::inTransit($this->world, $order);

    deliverCash($this, $job, ['collected_minor' => 1000])->assertOk();

    expect(receiptedOn($order))->toBe(1000)
        ->and($order->refresh()->status)->toBe(OrderStatus::Fulfilled)
        ->and(StaffNotification::withoutTenancy()->where('subject_id', $order->getKey())->count())->toBe(0);
});

it('needs a note for zero, and refuses without closing anything', function (): void {
    $order = RunWorld::order($this->world);
    $job = RunWorld::inTransit($this->world, $order);

    deliverCash($this, $job, ['collected_minor' => 0])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect($job->refresh()->status)->toBe('in_transit')
        ->and($order->refresh()->status)->toBe(OrderStatus::Confirmed);
});

it('takes zero with a note, puts the note on the job and alerts the managers', function (): void {
    $order = RunWorld::order($this->world);
    $job = RunWorld::inTransit($this->world, $order);

    deliverCash($this, $job, ['collected_minor' => 0, 'note' => 'Customer had no cash, will transfer'])->assertOk();

    expect(receiptedOn($order))->toBe(0)
        ->and($job->refresh()->proof_of_delivery_notes)->toBe('Customer had no cash, will transfer')
        ->and($order->refresh()->status)->toBe(OrderStatus::Fulfilled);

    // The world's own user holds the supervise permission, so they are the manager heard.
    $alert = StaffNotification::withoutTenancy()->where('subject_id', $order->getKey())->sole();

    expect($alert->type)->toBe(StaffAlertType::NoCashCollected->value)
        ->and($alert->user_id)->toBe($this->driverId);
});

it('refuses collecting more than is owed, and leaves the run open', function (): void {
    $order = RunWorld::order($this->world);
    $job = RunWorld::inTransit($this->world, $order);
    app(OrderPaymentReceipts::class)->write($order, PaymentMethod::CashOnDelivery, 1000, $this->driverId);

    deliverCash($this, $job, ['collected_minor' => 2001])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['collected_minor']]]]);

    expect($job->refresh()->status)->toBe('in_transit')
        ->and(receiptedOn($order))->toBe(1000);
});

it('requires an amount on a cash order', function (): void {
    $job = RunWorld::inTransit($this->world, RunWorld::order($this->world));

    deliverCash($this, $job)->assertStatus(422);

    expect($job->refresh()->status)->toBe('in_transit');
});

it('asks nothing when a paid order is handed over', function (): void {
    $order = RunWorld::order($this->world);
    $job = RunWorld::inTransit($this->world, $order);
    app(OrderPaymentReceipts::class)->write($order, PaymentMethod::CashOnDelivery, 3000, $this->driverId);

    deliverCash($this, $job, ['collected_minor' => 0])->assertOk();

    expect(receiptedOn($order))->toBe(3000)
        ->and(StaffNotification::withoutTenancy()->where('subject_id', $order->getKey())->count())->toBe(0);
});

it('ignores the amount on a WISH order and leaves it unpaid', function (): void {
    $order = RunWorld::order($this->world, ['payment_method' => PaymentMethod::Wish]);
    $job = RunWorld::inTransit($this->world, $order);

    deliverCash($this, $job, ['collected_minor' => 3000])->assertOk();

    expect(receiptedOn($order))->toBe(0)
        ->and($order->refresh()->status)->toBe(OrderStatus::Fulfilled);
});

it('needs no amount on a WISH order', function (): void {
    $order = RunWorld::order($this->world, ['payment_method' => PaymentMethod::Wish]);
    $job = RunWorld::inTransit($this->world, $order);

    deliverCash($this, $job)->assertOk();

    expect(receiptedOn($order))->toBe(0);
});

it('still receipts a pickup and a counter sale on fulfil', function (string $state): void {
    $order = Order::factory()->{$state}()->confirmed()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'customer_account_id' => $this->world->customer->account->getKey(),
        'sales_channel_id' => $this->world->channel->getKey(),
    ]);

    $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/fulfil', [], $this->world->headers + [
        'If-Match' => '"'.$order->lock_version.'"',
    ])->assertOk();

    expect(receiptedOn($order))->toBe($order->total_minor);
})->with(['pickup', 'counter']);

it('writes one receipt for a double press', function (): void {
    $order = RunWorld::order($this->world);
    $job = RunWorld::inTransit($this->world, $order);

    deliverCash($this, $job, ['collected_minor' => 3000])->assertOk();

    deliverCash($this, $job, ['collected_minor' => 3000])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    expect(OrderPaymentReceipt::query()->where('order_id', $order->getKey())->count())->toBe(1);
});

it('writes no receipt when the run closes between the read and the write', function (): void {
    $order = RunWorld::order($this->world);
    $job = RunWorld::inTransit($this->world, $order);

    // The kitchen closes the run the moment the driver's request has read it,
    // so the request passes its first check and only the conditional `UPDATE`
    // is left to refuse it.
    DeliveryJob::retrieved(function (DeliveryJob $read): void {
        DB::table('delivery_jobs')->where('id', $read->getKey())->update(['status' => 'delivered']);
    });

    deliverCash($this, $job, ['collected_minor' => 3000])->assertStatus(409);

    expect(receiptedOn($order))->toBe(0);
});

it('shows the driver what is still owed, in one read', function (): void {
    $paid = RunWorld::order($this->world);
    app(OrderPaymentReceipts::class)->write($paid, PaymentMethod::CashOnDelivery, 1000, $this->driverId);
    app(OrderPaymentReceipts::class)->write($paid, PaymentMethod::CashOnDelivery, 500, $this->driverId);
    RunWorld::inTransit($this->world, $paid);
    RunWorld::inTransit($this->world, RunWorld::order($this->world));

    $rows = collect($this->getJson('/api/v1/driver/jobs', $this->world->headers)->assertOk()->json('data.jobs'));

    expect($rows->pluck('amount_due_minor')->sort()->values()->all())->toBe([1500, 3000])
        ->and($rows->first()['currency_code'])->toBe('USD')
        ->and($rows->first()['payment_method'])->toBe('cash_on_delivery');
});
