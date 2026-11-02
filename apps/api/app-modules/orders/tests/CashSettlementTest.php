<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| Cash coming back from the road
|--------------------------------------------------------------------------
|
| A driver's receipts already exist, so a hand-in only records the money reaching
| the kitchen. A courier's do not, so settling writes them.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->world = RunWorld::build('settle@kitchen.test', ['order.view_organisation', 'order.manage_organisation', 'order.supervise_organisation', 'order.settle_cash_organisation']);
    $this->actingAs($this->world->tenant->user);
});

function driverRun(object $test, int $collectedMinor): DeliveryJob
{
    $order = RunWorld::order($test->world, ['status' => OrderStatus::Fulfilled, 'total_minor' => 3000]);
    $driver = $test->world->tenant->user->getKey();

    OrderPaymentReceipt::factory()->create([
        'organisation_id' => $order->organisation_id,
        'order_id' => $order->getKey(),
        'amount_minor' => $collectedMinor,
        'currency_code' => $order->currency_code,
        'confirmed_by' => $driver,
        'confirmed_at' => now(),
    ]);

    return RunWorld::job($test->world, $order, [
        'driver_user_id' => $driver,
        'status' => 'delivered',
        'tracking_status' => 'delivered',
        'delivered_at' => now(),
    ]);
}

function courierRun(object $test, int $feeMinor, string $name = 'Toters'): DeliveryJob
{
    $order = RunWorld::order($test->world, ['status' => OrderStatus::Fulfilled, 'total_minor' => 3000]);

    return RunWorld::job($test->world, $order, [
        'status' => 'delivered',
        'tracking_status' => 'delivered',
        'delivered_at' => now(),
        'courier_name' => $name,
        'courier_reference' => 'T-'.Str::random(5),
        'courier_fee_minor' => $feeMinor,
    ]);
}

/**
 * @param  list<DeliveryJob>  $jobs
 */
function settle(object $test, array $jobs, int $handedInMinor, ?string $reason = null): TestResponse
{
    return $test->postJson('/api/v1/catalogue/order-desk/settlements', [
        'job_ids' => array_map(static fn (DeliveryJob $job): string => (string) $job->getKey(), $jobs),
        'handed_in_minor' => $handedInMinor,
        'short_reason' => $reason,
    ], $test->world->headers + ['Idempotency-Key' => (string) Str::uuid()]);
}

it('lists a driver\'s cash, and settles it in full with nothing to sign', function (): void {
    $one = driverRun($this, 3000);
    $two = driverRun($this, 2000);

    $this->getJson('/api/v1/catalogue/order-desk/settlements', $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.drivers.0.collected_minor', 5000)
        ->assertJsonCount(2, 'data.drivers.0.runs');

    settle($this, [$one, $two], 5000)
        ->assertCreated()
        ->assertJsonPath('data.settlement.short_minor', 0);

    $this->getJson('/api/v1/catalogue/order-desk/settlements', $this->world->headers)
        ->assertJsonCount(0, 'data.drivers')
        ->assertJsonCount(1, 'data.settlements');
});

it('needs a reason for a short hand-in, and a manager to sign it, once', function (): void {
    $run = driverRun($this, 3000);

    settle($this, [$run], 2500)->assertUnprocessable();

    $id = settle($this, [$run], 2500, 'Change given from own pocket')
        ->assertCreated()
        ->assertJsonPath('data.settlement.short_minor', 500)
        ->assertJsonPath('data.settlement.signed_off_at', null)
        ->json('data.settlement.id');

    $url = '/api/v1/catalogue/order-desk/settlements/'.$id.'/sign-off';

    $this->postJson($url, [], $this->world->headers)->assertOk();
    $this->postJson($url, [], $this->world->headers)->assertConflict();

    expect(AuditLog::query()->where('action', 'order.cash_short_signed_off')->where('subject_id', $id)->exists())->toBeTrue();
});

it('alerts the managers to a short hand-in, and links to the settlement page', function (): void {
    $id = settle($this, [driverRun($this, 3000)], 2500, 'Change given from own pocket')->json('data.settlement.id');

    expect(StaffNotification::withoutTenancy()
        ->where('type', StaffAlertType::ShortHandIn->value)
        ->where('subject_type', 'cash_settlement')
        ->where('subject_id', $id)
        ->exists())->toBeTrue();
});

it('leaves a run from before settlement off the list, and refuses to settle it', function (): void {
    $old = driverRun($this, 3000);
    DB::table('delivery_jobs')->where('id', $old->getKey())->update(['predates_settlement' => true]);
    $new = driverRun($this, 2000);

    $this->getJson('/api/v1/catalogue/order-desk/settlements', $this->world->headers)
        ->assertJsonPath('data.drivers.0.collected_minor', 2000);

    settle($this, [$old], 3000)->assertConflict();
    settle($this, [$new], 2000)->assertCreated();
});

it('refuses to settle a run twice', function (): void {
    $run = driverRun($this, 3000);

    settle($this, [$run], 3000)->assertCreated();
    settle($this, [$run], 3000)->assertConflict();
});

it('refuses more than the runs brought in', function (): void {
    settle($this, [driverRun($this, 3000)], 3001)->assertUnprocessable();
});

it('settles a courier batch against the amount, writing each receipt in full', function (): void {
    $one = courierRun($this, 300);
    $two = courierRun($this, 200);

    settle($this, [$one, $two], 5500)
        ->assertCreated()
        ->assertJsonPath('data.settlement.expected_minor', 6000)
        ->assertJsonPath('data.settlement.fee_minor', 500)
        ->assertJsonPath('data.settlement.short_minor', 0);

    $order = Order::query()->whereKey($one->order_id)->sole();

    expect($order->receivedMinor())->toBe(3000)
        ->and(OrderPaymentReceipt::query()->where('order_id', $order->getKey())->sole()->reference)->toBe($one->courier_reference);
});

it('refuses two couriers on one hand-in', function (): void {
    settle($this, [courierRun($this, 0), courierRun($this, 0, 'Wakilni')], 6000)->assertUnprocessable();
});

it('leaves a run no cash reached off the driver list', function (): void {
    $order = RunWorld::order($this->world, ['status' => OrderStatus::Fulfilled]);
    RunWorld::job($this->world, $order, [
        'driver_user_id' => $this->world->tenant->user->getKey(),
        'status' => 'delivered',
        'tracking_status' => 'delivered',
        'delivered_at' => now(),
    ]);

    $this->getJson('/api/v1/catalogue/order-desk/settlements', $this->world->headers)
        ->assertJsonCount(0, 'data.drivers');
});

it('shows the courier fee and the short amount beside the cash report rows', function (): void {
    settle($this, [courierRun($this, 300)], 2500, 'Courier kept change')->assertCreated();

    $today = now('UTC')->toDateString();

    $adjustments = $this->getJson('/api/v1/catalogue/order-desk/cash-report?from='.$today.'&to='.$today, $this->world->headers)
        ->assertOk()
        ->json('data.adjustments');

    expect(collect($adjustments)->pluck('amount_minor_sum', 'kind')->all())->toBe(['courier_fee' => 300, 'short' => 200]);
});

it('is closed to a member without the code, and a sign-off to one without the manager code', function (): void {
    $run = driverRun($this, 3000);
    $id = settle($this, [$run], 2000, 'Short')->json('data.settlement.id');

    $this->world = RunWorld::build('cook@kitchen.test', ['order.view_organisation']);
    $this->actingAs($this->world->tenant->user);

    $this->getJson('/api/v1/catalogue/order-desk/settlements', $this->world->headers)->assertForbidden();
    $this->postJson('/api/v1/catalogue/order-desk/settlements/'.$id.'/sign-off', [], $this->world->headers)->assertForbidden();
});
