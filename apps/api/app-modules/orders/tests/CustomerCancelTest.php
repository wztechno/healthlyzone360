<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| A customer calls off their own order, before the kitchen accepts it
|--------------------------------------------------------------------------
|
| The owner's rule: only while `placed`. After that the customer contacts the
| kitchen. The race is run the way `LateCancelTest` runs it: the accept lands the
| moment the cancel has read the order, so only the conditional `UPDATE` in
| `OrderLifecycle::transition()` is left to refuse it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->app->instance(OrderStockConsumption::class, Mockery::spy(OrderStockConsumption::class));

    $this->world = RunWorld::build('customer-cancel@kitchen.test');
    $this->customer = User::query()->whereKey($this->world->customer->account->user_id)->sole();
    $this->actingAs($this->customer);
});

function customerPlacedOrder(object $world): Order
{
    return RunWorld::order($world, ['status' => OrderStatus::Placed, 'confirmed_at' => null]);
}

function customerCancel(object $test, Order $order): TestResponse
{
    return $test->postJson('/api/v1/me/orders/'.$order->getKey().'/cancel', [], firstPartyHeaders());
}

function customerCancelAlerts(Order $order): int
{
    return StaffNotification::withoutTenancy()
        ->where('subject_id', $order->getKey())
        ->where('type', StaffAlertType::CustomerCancelled->value)
        ->count();
}

it('cancels a placed order as the customer asked, and stamps who did it', function (): void {
    $order = customerPlacedOrder($this->world);

    customerCancel($this, $order)->assertOk()
        ->assertJsonPath('data.order.status', 'cancelled');

    $order->refresh();

    expect($order->status)->toBe(OrderStatus::Cancelled)
        ->and($order->cancellation_reason)->toBe(CancellationReason::CustomerRequested)
        ->and($order->cancelled_by)->toBe((string) $this->customer->getKey());

    // The stock the order held goes back, once.
    app(OrderStockConsumption::class)->shouldHaveReceived('restore')->once();
});

it('refuses once the kitchen has accepted the order', function (): void {
    $order = RunWorld::order($this->world);

    customerCancel($this, $order)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.reason', 'order_already_accepted');

    expect($order->refresh()->status)->toBe(OrderStatus::Confirmed);
});

it('lets exactly one of accept and cancel win when the accept lands first', function (): void {
    $order = customerPlacedOrder($this->world);
    $fired = false;

    // The kitchen accepts the order the moment the cancel has read it, at the
    // same lock version, so the cancel's own status check passes.
    Order::retrieved(function (Order $read) use (&$fired): void {
        if ($fired) {
            return;
        }

        $fired = true;

        DB::table('orders')->where('id', $read->getKey())->update([
            'status' => OrderStatus::Confirmed->value,
            'confirmed_at' => now(),
            'lock_version' => DB::raw('lock_version + 1'),
        ]);
    });

    customerCancel($this, $order)
        ->assertStatus(409)
        ->assertJsonPath('error.details.reason', 'order_already_accepted');

    $order->refresh();

    expect($order->status)->toBe(OrderStatus::Confirmed)
        ->and($order->cancelled_at)->toBeNull()
        ->and(customerCancelAlerts($order))->toBe(0);

    app(OrderStockConsumption::class)->shouldNotHaveReceived('restore');
});

it('says the order is already cancelled when the kitchen cancelled it first', function (): void {
    $order = customerPlacedOrder($this->world);
    $fired = false;

    // The kitchen's cancel lands the moment the customer's has read the order.
    Order::retrieved(function (Order $read) use (&$fired): void {
        if ($fired) {
            return;
        }

        $fired = true;

        DB::table('orders')->where('id', $read->getKey())->update([
            'status' => OrderStatus::Cancelled->value,
            'cancelled_at' => now(),
            'lock_version' => DB::raw('lock_version + 1'),
        ]);
    });

    customerCancel($this, $order)
        ->assertStatus(409)
        ->assertJsonPath('error.details.reason', 'order_already_cancelled');

    // And once it is plainly cancelled, the status check says the same.
    customerCancel($this, $order)
        ->assertStatus(409)
        ->assertJsonPath('error.details.reason', 'order_already_cancelled');

    expect(customerCancelAlerts($order))->toBe(0);
    app(OrderStockConsumption::class)->shouldNotHaveReceived('restore');
});

it('answers somebody else\'s order with a 404', function (): void {
    $order = customerPlacedOrder($this->world);

    $stranger = CheckoutWorld::readyCustomer($this->world->area);
    $this->actingAs(User::query()->whereKey($stranger->account->user_id)->sole());

    customerCancel($this, $order)->assertNotFound();

    expect($order->refresh()->status)->toBe(OrderStatus::Placed);
});

it('alerts the managers once, with the order number only', function (): void {
    Exceptions::fake();
    $order = customerPlacedOrder($this->world);

    customerCancel($this, $order)->assertOk();
    customerCancel($this, $order)->assertStatus(409);

    $alert = StaffNotification::withoutTenancy()
        ->where('subject_id', $order->getKey())
        ->where('user_id', $this->world->tenant->user->getKey())
        ->sole();

    expect($alert->type)->toBe(StaffAlertType::CustomerCancelled->value)
        ->and($alert->data)->toBe(['order_number' => $order->order_number]);

    // The second press's deliberate 409 is the only thing reported: the alert
    // swallowed no failure of its own.
    Exceptions::assertReportedCount(1);
    Exceptions::assertReported(fn (ApiException $refused): bool => $refused->status() === 409);
});
