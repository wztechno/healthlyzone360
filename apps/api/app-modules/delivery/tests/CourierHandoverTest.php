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
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| A courier is not a driver on this kitchen's sheet
|--------------------------------------------------------------------------
|
| Handing an order to a courier company is written down by the desk, and it ends
| on the kitchen's own two actions. Cash from a courier stays unpaid until batch
| settlement in Stage 3.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->world = RunWorld::build('courier@kitchen.test');
    $this->actingAs($this->world->tenant->user);

    $this->order = RunWorld::order($this->world, ['ready_at' => now()]);
    $this->job = RunWorld::job($this->world, $this->order);
});

/**
 * @param  array<string, mixed>  $body
 */
function courierPost(object $test, Order $order, string $action, array $body = []): TestResponse
{
    return $test->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/delivery/'.$action, $body, $test->world->headers);
}

it('records the courier and puts the food on the road', function (): void {
    courierPost($this, $this->order, 'courier', ['name' => 'Toters', 'reference' => 'T-4471', 'fee_minor' => 300])
        ->assertOk()
        ->assertJsonPath('data.order.delivery_run.courier_name', 'Toters')
        ->assertJsonPath('data.order.delivery.picked_up_at', fn (mixed $at): bool => is_string($at));

    $this->job->refresh();

    expect($this->job->status)->toBe('in_transit')
        ->and($this->job->tracking_status)->toBe('en_route')
        ->and($this->job->picked_up_at)->not->toBeNull()
        ->and($this->job->driver_user_id)->toBeNull()
        ->and($this->job->courier_name)->toBe('Toters')
        ->and($this->job->courier_reference)->toBe('T-4471')
        ->and($this->job->courier_fee_minor)->toBe(300)
        ->and(AuditLog::query()->where('action', 'delivery.job_handed_to_courier')->count())->toBe(1);
});

it('takes the run from a driver who had it but never left', function (): void {
    $this->job->forceFill([
        'driver_user_id' => $this->world->tenant->user->getKey(),
        'status' => 'assigned',
        'assigned_at' => now(),
    ])->save();

    courierPost($this, $this->order, 'courier', ['name' => 'Toters'])->assertOk();

    expect($this->job->refresh()->driver_user_id)->toBeNull();
});

it('keeps courier orders off every driver list', function (): void {
    courierPost($this, $this->order, 'courier', ['name' => 'Toters'])->assertOk();

    $this->getJson('/api/v1/driver/jobs', $this->world->headers)
        ->assertJsonCount(0, 'data.jobs')
        ->assertJsonCount(0, 'data.available');
});

it('needs a name, and food that is ready', function (): void {
    courierPost($this, $this->order, 'courier')->assertStatus(422);

    $unready = RunWorld::order($this->world);
    RunWorld::job($this->world, $unready);

    courierPost($this, $unready, 'courier', ['name' => 'Toters'])->assertStatus(409);
});

it('refuses a run a driver has already taken', function (): void {
    $order = RunWorld::order($this->world, ['ready_at' => now()]);
    RunWorld::inTransit($this->world, $order);

    courierPost($this, $order, 'courier', ['name' => 'Toters'])->assertStatus(409);
});

it('refuses the driver a courier run', function (): void {
    courierPost($this, $this->order, 'courier', ['name' => 'Toters'])->assertOk();

    $this->postJson("/api/v1/driver/jobs/{$this->job->getKey()}/pick-up", [], $this->world->headers)->assertNotFound();
    $this->postJson("/api/v1/driver/jobs/{$this->job->getKey()}/claim", [], $this->world->headers)->assertStatus(409);

    $this->postJson("/api/v1/delivery/jobs/{$this->job->getKey()}/assign", [
        'driver_user_id' => $this->world->tenant->user->getKey(),
    ], $this->world->headers + ['If-Match' => '"'.$this->job->refresh()->lock_version.'"'])->assertStatus(409);
});

it('cannot be cancelled once the courier has it', function (): void {
    courierPost($this, $this->order, 'courier', ['name' => 'Toters'])->assertOk();

    $this->postJson('/api/v1/catalogue/orders/'.$this->order->getKey().'/cancel', [
        'reason' => 'customer_requested',
        'disposition' => 'returned',
    ], $this->world->headers + ['If-Match' => '"'.$this->order->lock_version.'"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'order.out_for_delivery');
});

it('closes as delivered with the existing action and stays unpaid', function (): void {
    courierPost($this, $this->order, 'courier', ['name' => 'Toters'])->assertOk();

    $this->postJson('/api/v1/catalogue/orders/'.$this->order->getKey().'/fulfil', [], $this->world->headers + [
        'If-Match' => '"'.$this->order->lock_version.'"',
    ])->assertOk();

    expect($this->order->refresh()->status)->toBe(OrderStatus::Fulfilled)
        ->and($this->job->refresh()->status)->toBe('delivered')
        ->and(OrderPaymentReceipt::query()->where('order_id', $this->order->getKey())->count())->toBe(0);
});

it('closes as failed on the courier\'s behalf, and re-delivering clears the courier', function (): void {
    courierPost($this, $this->order, 'courier', ['name' => 'Toters', 'reference' => 'T-4471'])->assertOk();

    courierPost($this, $this->order, 'fail', ['reason' => 'unreachable', 'note' => 'Courier called'])
        ->assertOk()
        ->assertJsonPath('data.order.delivery_run.status', 'failed');

    expect($this->order->refresh()->status)->toBe(OrderStatus::Confirmed)
        ->and(OrderPaymentReceipt::query()->where('order_id', $this->order->getKey())->count())->toBe(0);

    $this->postJson('/api/v1/catalogue/orders/'.$this->order->getKey().'/delivery/redeliver', [], $this->world->headers + [
        'If-Match' => '"'.$this->order->lock_version.'"',
    ])->assertOk();

    /** @var DeliveryJob $job */
    $job = $this->job->refresh();

    expect($job->status)->toBe('pending')
        ->and($job->courier_name)->toBeNull()
        ->and($job->courier_reference)->toBeNull()
        ->and($job->courier_fee_minor)->toBeNull();
});

it('keeps the courier routes for staff who manage orders', function (): void {
    $world = RunWorld::build('courier-reader@kitchen.test', ['order.view_organisation']);
    $this->world = $world;
    $this->actingAs($world->tenant->user);

    courierPost($this, $this->order, 'courier', ['name' => 'Toters'])->assertForbidden();
});
