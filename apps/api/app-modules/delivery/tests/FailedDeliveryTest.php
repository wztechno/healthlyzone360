<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Healthy360\Orders\Enums\CancellationDisposition;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| A failed delivery had no state to be in
|--------------------------------------------------------------------------
|
| The food came back and the only way to say so was to cancel or to lie. A
| failure is a state of the run, the order waits in `confirmed`, and a manager
| decides what happens next.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->consumption = Mockery::spy(OrderStockConsumption::class);
    $this->app->instance(OrderStockConsumption::class, $this->consumption);

    $this->world = RunWorld::build('failed@kitchen.test');
    $this->actingAs($this->world->tenant->user);

    $this->order = RunWorld::order($this->world, ['ready_at' => now()]);
    $this->job = RunWorld::inTransit($this->world, $this->order);
});

/**
 * @param  array<string, mixed>  $body
 */
function failRun(object $test, DeliveryJob $job, array $body = ['reason' => 'no_answer', 'note' => 'Rang twice']): TestResponse
{
    return $test->postJson("/api/v1/driver/jobs/{$job->getKey()}/fail", $body, $test->world->headers);
}

/**
 * @param  array<string, mixed>  $body
 */
function deliveryAction(object $test, Order $order, string $action, array $body = []): TestResponse
{
    return $test->postJson(
        '/api/v1/catalogue/orders/'.$order->getKey().'/delivery/'.$action,
        $body,
        $test->world->headers + ['If-Match' => '"'.$order->fresh()->lock_version.'"'],
    );
}

it('fails the run, keeps the order confirmed, writes no receipt and tells the managers', function (): void {
    failRun($this, $this->job)->assertOk()->assertJsonPath('data.job.status', 'failed');

    $this->job->refresh();

    expect($this->job->status)->toBe('failed')
        ->and($this->job->failed_at)->not->toBeNull()
        ->and($this->job->failure_reason)->toBe('no_answer')
        ->and($this->job->failure_note)->toBe('Rang twice')
        ->and($this->order->refresh()->status)->toBe(OrderStatus::Confirmed)
        ->and(OrderPaymentReceipt::query()->where('order_id', $this->order->getKey())->count())->toBe(0)
        ->and(AuditLog::query()->where('action', 'delivery.job_failed')->count())->toBe(1);

    $alert = StaffNotification::withoutTenancy()->where('subject_id', $this->order->getKey())->sole();

    expect($alert->type)->toBe(StaffAlertType::DeliveryFailed->value);
});

it('takes a failed run off the driver\'s sheet', function (): void {
    failRun($this, $this->job)->assertOk();

    $this->getJson('/api/v1/driver/jobs', $this->world->headers)
        ->assertJsonCount(0, 'data.jobs')
        ->assertJsonCount(0, 'data.available');
});

it('refuses a reason outside the list', function (): void {
    failRun($this, $this->job, ['reason' => 'gave_up'])->assertStatus(422);

    expect($this->job->refresh()->status)->toBe('in_transit');
});

it('will not fail somebody else\'s run', function (): void {
    $this->job->forceFill(['driver_user_id' => RunWorld::member((string) $this->world->organisation->getKey(), 'driver')->getKey()])->save();

    failRun($this, $this->job)->assertNotFound();
});

it('will not fail a run that is not on the road', function (): void {
    $job = RunWorld::job($this->world, RunWorld::order($this->world), [
        'driver_user_id' => $this->world->tenant->user->getKey(),
        'status' => 'assigned',
    ]);

    failRun($this, $job)->assertStatus(409);
});

it('refuses picking up, delivering or claiming a failed run', function (): void {
    failRun($this, $this->job)->assertOk();

    $headers = $this->world->headers;

    $this->postJson("/api/v1/driver/jobs/{$this->job->getKey()}/pick-up", [], $headers)->assertStatus(409);
    $this->postJson("/api/v1/driver/jobs/{$this->job->getKey()}/claim", [], $headers)->assertStatus(409);
    $this->postJson("/api/v1/driver/jobs/{$this->job->getKey()}/deliver", ['collected_minor' => 3000], $headers)->assertStatus(409);

    expect($this->job->refresh()->status)->toBe('failed')
        ->and(OrderPaymentReceipt::query()->where('order_id', $this->order->getKey())->count())->toBe(0);
});

it('refuses marking a failed delivery delivered without a re-deliver', function (): void {
    failRun($this, $this->job)->assertOk();

    $this->postJson('/api/v1/catalogue/orders/'.$this->order->getKey().'/fulfil', [], $this->world->headers + [
        'If-Match' => '"'.$this->order->lock_version.'"',
    ])->assertStatus(409);

    expect($this->order->refresh()->status)->toBe(OrderStatus::Confirmed)
        ->and($this->job->refresh()->status)->toBe('failed');
});

it('shows the kitchen why, and offers re-deliver and close only on a failed run', function (): void {
    deliveryAction($this, $this->order, 'redeliver')->assertStatus(409);
    deliveryAction($this, $this->order, 'close-failed', ['disposition' => 'returned'])->assertStatus(409);

    failRun($this, $this->job)->assertOk();

    $this->getJson('/api/v1/catalogue/orders/'.$this->order->getKey(), $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.order.delivery_run.status', 'failed')
        ->assertJsonPath('data.order.delivery_run.failure_reason', 'no_answer')
        ->assertJsonPath('data.order.delivery_run.failure_note', 'Rang twice');
});

it('re-delivers: back to pending, nobody on it, offered to drivers again', function (): void {
    failRun($this, $this->job)->assertOk();

    deliveryAction($this, $this->order, 'redeliver')->assertOk();

    $this->job->refresh();

    expect($this->job->status)->toBe('pending')
        ->and($this->job->tracking_status)->toBe('awaiting_assignment')
        ->and($this->job->driver_user_id)->toBeNull()
        ->and($this->job->picked_up_at)->toBeNull()
        ->and($this->job->failed_at)->toBeNull()
        ->and($this->job->failure_reason)->toBeNull()
        ->and($this->order->refresh()->ready_at)->not->toBeNull()
        ->and(AuditLog::query()->where('action', 'delivery.job_reopened')->count())->toBe(1);

    $this->getJson('/api/v1/driver/jobs', $this->world->headers)->assertJsonCount(1, 'data.available');
});

it('moves the order to a new day and window the schedule accepts', function (): void {
    $branch = $this->world->branch;
    $this->order->forceFill(['branch_id' => $branch->getKey()])->save();
    failRun($this, $this->job)->assertOk();
    $day = CarbonImmutable::now()->addDays(2)->toDateString();

    deliveryAction($this, $this->order, 'redeliver', ['date' => $day, 'window' => 'evening'])
        ->assertOk()
        ->assertJsonPath('data.order.delivery.requested_date', $day)
        ->assertJsonPath('data.order.delivery.window_code', 'evening');

    $this->order->refresh();

    expect($this->order->requested_delivery_date->toDateString())->toBe($day)
        ->and($this->order->delivery_window_code)->toBe('evening');
});

it('refuses a new day in the past and leaves the run failed', function (): void {
    $this->order->forceFill(['branch_id' => $this->world->branch->getKey()])->save();
    failRun($this, $this->job)->assertOk();
    $before = $this->order->refresh()->requested_delivery_date;

    deliveryAction($this, $this->order, 'redeliver', ['date' => CarbonImmutable::now()->subDays(3)->toDateString()])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'order.placement_refused');

    expect($this->job->refresh()->status)->toBe('failed')
        ->and($this->order->refresh()->requested_delivery_date?->toDateString())->toBe($before?->toDateString());
});

it('closes a failed delivery as wasted, keeping the deduction and the failed run', function (): void {
    failRun($this, $this->job)->assertOk();

    deliveryAction($this, $this->order, 'close-failed', ['disposition' => 'wasted'])
        ->assertOk()
        ->assertJsonPath('data.order.status', 'cancelled')
        ->assertJsonPath('data.order.cancellation_reason', 'delivery_failed')
        ->assertJsonPath('data.order.cancellation_disposition', 'wasted');

    $this->order->refresh();

    expect($this->order->cancellation_reason)->toBe(CancellationReason::DeliveryFailed)
        ->and($this->order->cancellation_disposition)->toBe(CancellationDisposition::Wasted)
        ->and($this->job->refresh()->status)->toBe('failed');

    $this->consumption->shouldNotHaveReceived('restore');
});

it('closes a failed delivery as returned, restoring the stock', function (): void {
    failRun($this, $this->job)->assertOk();

    deliveryAction($this, $this->order, 'close-failed', ['disposition' => 'returned'])->assertOk();

    $this->consumption->shouldHaveReceived('restore')->once();
});

it('needs a disposition to close', function (): void {
    failRun($this, $this->job)->assertOk();

    deliveryAction($this, $this->order, 'close-failed')->assertStatus(422);

    expect($this->order->refresh()->status)->toBe(OrderStatus::Confirmed);
});

it('keeps re-deliver and close for the supervise permission', function (): void {
    $world = RunWorld::build('failed-staff@kitchen.test', ['order.view_organisation', 'order.manage_organisation']);
    $this->world = $world;
    $this->actingAs($world->tenant->user);
    $order = RunWorld::order($world, ['ready_at' => now()]);
    RunWorld::job($world, $order, ['status' => 'failed', 'failed_at' => now(), 'picked_up_at' => now()]);

    deliveryAction($this, $order, 'redeliver')->assertForbidden();
    deliveryAction($this, $order, 'close-failed', ['disposition' => 'returned'])->assertForbidden();
});
