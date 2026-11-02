<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Healthy360\Orders\Enums\CancellationDisposition;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderLifecycle;
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
| A cancelled order that stayed on offer to drivers
|--------------------------------------------------------------------------
|
| The audit proved it live: Ready, then Cancel, and the job was still under
| Available runs. One test per row of the spec's table, then the two ends of the
| food, then the race. The race cannot be run with two connections inside a test
| transaction, so each order of arrival is run in turn: the conditional `UPDATE`
| is what makes those the only two outcomes.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->consumption = Mockery::spy(OrderStockConsumption::class);
    $this->app->instance(OrderStockConsumption::class, $this->consumption);

    $this->world = RunWorld::build('late-cancel@kitchen.test');
    $this->actingAs($this->world->tenant->user);
});

/**
 * @param  array<string, mixed>  $body
 */
function cancelLate(object $test, Order $order, array $body = []): TestResponse
{
    return $test->postJson(
        '/api/v1/catalogue/orders/'.$order->getKey().'/cancel',
        ['reason' => 'customer_requested', ...$body],
        $test->world->headers + ['If-Match' => '"'.$order->lock_version.'"'],
    );
}

it('cancels a placed order with a reason alone', function (): void {
    $order = RunWorld::order($this->world, ['status' => OrderStatus::Placed, 'confirmed_at' => null]);

    cancelLate($this, $order)->assertOk()
        ->assertJsonPath('data.order.status', 'cancelled')
        ->assertJsonPath('data.order.cancellation_disposition', null);
});

it('cancels a confirmed order nobody started, restores the stock and closes the run', function (): void {
    $order = RunWorld::order($this->world);
    $job = RunWorld::job($this->world, $order);

    cancelLate($this, $order)->assertOk();

    expect($job->refresh()->status)->toBe('cancelled')
        ->and(StaffNotification::withoutTenancy()->where('subject_id', $order->getKey())->count())->toBe(0);

    $this->consumption->shouldHaveReceived('restore')->once();
});

it('ignores a disposition on an order nobody started', function (): void {
    $order = RunWorld::order($this->world);

    cancelLate($this, $order, ['disposition' => 'wasted'])->assertOk()
        ->assertJsonPath('data.order.cancellation_disposition', null);

    $this->consumption->shouldHaveReceived('restore')->once();
});

it('refuses a started order without the supervise permission', function (string $stamp): void {
    $world = RunWorld::build('late-cancel-staff@kitchen.test', ['order.view_organisation', 'order.manage_organisation']);
    $this->world = $world;
    $this->actingAs($world->tenant->user);
    $order = RunWorld::order($world, [$stamp => now()]);

    cancelLate($this, $order, ['disposition' => 'returned'])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied');

    expect($order->refresh()->status)->toBe(OrderStatus::Confirmed);
})->with(['preparing_at', 'ready_at']);

it('refuses a started order without a disposition', function (): void {
    $order = RunWorld::order($this->world, ['preparing_at' => now()]);

    cancelLate($this, $order)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect($order->refresh()->status)->toBe(OrderStatus::Confirmed);
});

it('restores the stock when the food came back', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);

    cancelLate($this, $order, ['disposition' => 'returned'])->assertOk()
        ->assertJsonPath('data.order.cancellation_disposition', 'returned');

    expect($order->refresh()->cancellation_disposition)->toBe(CancellationDisposition::Returned);

    $this->consumption->shouldHaveReceived('restore')->once();
});

it('keeps the deduction when the food was wasted', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);

    cancelLate($this, $order, ['disposition' => 'wasted'])->assertOk()
        ->assertJsonPath('data.order.cancellation_disposition', 'wasted');

    $this->consumption->shouldNotHaveReceived('restore');
});

it('takes a ready order off the driver list and tells the owner', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);
    $job = RunWorld::job($this->world, $order);

    expect($this->getJson('/api/v1/driver/jobs', $this->world->headers)->json('data.available'))->toHaveCount(1);

    cancelLate($this, $order, ['disposition' => 'returned'])->assertOk();

    expect($job->refresh()->status)->toBe('cancelled');

    $this->getJson('/api/v1/driver/jobs', $this->world->headers)
        ->assertJsonCount(0, 'data.available')
        ->assertJsonCount(0, 'data.jobs');

    $alert = StaffNotification::withoutTenancy()->where('subject_id', $order->getKey())->sole();

    expect($alert->type)->toBe(StaffAlertType::LateCancel->value)
        ->and($alert->user_id)->toBe((string) $this->world->ownerAlerted->getKey());
});

it('takes a driver\'s assigned run off their sheet', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);
    RunWorld::job($this->world, $order, ['driver_user_id' => $this->world->tenant->user->getKey(), 'status' => 'assigned']);

    cancelLate($this, $order, ['disposition' => 'wasted'])->assertOk();

    $this->getJson('/api/v1/driver/jobs', $this->world->headers)->assertJsonCount(0, 'data.jobs');
});

it('refuses food on the road for everybody, and leaves the order and stock alone', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);
    $job = RunWorld::inTransit($this->world, $order);

    cancelLate($this, $order, ['disposition' => 'returned'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'order.out_for_delivery');

    $order->refresh();

    expect($order->status)->toBe(OrderStatus::Confirmed)
        ->and($order->cancelled_at)->toBeNull()
        ->and($order->cancellation_reason)->toBeNull()
        ->and($job->refresh()->status)->toBe('in_transit');

    $this->consumption->shouldNotHaveReceived('restore');
});

it('refuses the reason only closing a failed delivery may set', function (): void {
    $order = RunWorld::order($this->world);

    cancelLate($this, $order, ['reason' => 'delivery_failed'])->assertStatus(422);

    expect($order->refresh()->status)->toBe(OrderStatus::Confirmed);
});

it('settles a pick-up that lands first by refusing the cancel', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);
    $job = RunWorld::job($this->world, $order, ['driver_user_id' => $this->world->tenant->user->getKey(), 'status' => 'assigned']);

    $this->postJson("/api/v1/driver/jobs/{$job->getKey()}/pick-up", [], $this->world->headers)->assertOk();

    cancelLate($this, $order, ['disposition' => 'returned'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'order.out_for_delivery');

    expect($order->refresh()->status)->toBe(OrderStatus::Confirmed)
        ->and($job->refresh()->status)->toBe('in_transit');
});

it('settles a cancel that lands first by refusing the pick-up', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);
    $job = RunWorld::job($this->world, $order, ['driver_user_id' => $this->world->tenant->user->getKey(), 'status' => 'assigned']);

    cancelLate($this, $order, ['disposition' => 'returned'])->assertOk();

    $this->postJson("/api/v1/driver/jobs/{$job->getKey()}/pick-up", [], $this->world->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    expect(DeliveryJob::withoutTenancy()->whereKey($job->getKey())->value('picked_up_at'))->toBeNull();
});

it('refuses a pick-up the cancel beat between its read and its write', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);
    $job = RunWorld::job($this->world, $order, ['driver_user_id' => $this->world->tenant->user->getKey(), 'status' => 'assigned']);

    // The cancel lands the moment the pick-up has read the run, so its first
    // check passes and only the conditional `UPDATE` is left to refuse it.
    DeliveryJob::retrieved(function (DeliveryJob $read): void {
        DB::table('delivery_jobs')->where('id', $read->getKey())->update(['status' => 'cancelled']);
    });

    $this->postJson("/api/v1/driver/jobs/{$job->getKey()}/pick-up", [], $this->world->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    expect(DB::table('delivery_jobs')->where('id', $job->getKey())->value('picked_up_at'))->toBeNull();
});

it('keeps working for a caller with no screen behind it', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);

    $cancelled = app(OrderLifecycle::class)->cancel($order, CancellationReason::KitchenUnableToFulfil);

    expect($cancelled->status)->toBe(OrderStatus::Cancelled)
        ->and($cancelled->cancellation_disposition)->toBeNull();

    $this->consumption->shouldHaveReceived('restore')->once();
});
