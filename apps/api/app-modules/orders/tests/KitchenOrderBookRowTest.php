<?php

declare(strict_types=1);

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The order book's rows carry what the desk queue's rows carry
|--------------------------------------------------------------------------
|
| The kitchen's Orders page reads one day, a week or the whole book from
| `GET /catalogue/orders`, and every row needs the facts a desk row has: what
| has been paid, the delivery run, and — for a caller allowed to read it — the
| customer's name and number. It also narrows by the calendar's day (the
| requested day, else the day placed), by slot and by delivery or pickup.
| Read-only: nothing here moves an order.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('book@kitchen.test', ['order.view_organisation']);
    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->organisation, 'web-shop')->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();

    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];

    $this->actingAs($this->tenant->user);
});

/**
 * @param  array<string, mixed>  $attributes
 */
function bookOrder(object $test, array $attributes = [], ?string $state = null): Order
{
    $factory = $state === null ? Order::factory() : Order::factory()->{$state}();

    return $factory->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        ...$attributes,
    ]);
}

/**
 * @param  list<string>  $permissions
 */
function bookAgent(string $organisationId, string $email, array $permissions): User
{
    $user = User::factory()->create(['email' => $email]);

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisationId,
        'user_id' => $user->getKey(),
    ]);

    $role = Role::factory()->create(['organisation_id' => $organisationId]);

    foreach ($permissions as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $organisationId,
            'role_id' => $role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    MembershipRole::factory()->create([
        'organisation_id' => $organisationId,
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    return $user;
}

it('carries the payment position and the run on every row, and no customer without the contact code', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    $paid = bookOrder($this, ['requested_delivery_date' => '2026-05-10', 'placed_at' => '2026-05-09 10:00:00']);
    OrderPaymentReceipt::factory()->create([
        'organisation_id' => $this->orgId,
        'order_id' => $paid->getKey(),
        'confirmed_by' => $this->tenant->user->getKey(),
        'amount_minor' => 1200,
    ]);

    $delivery = bookOrder($this, [
        'requested_delivery_date' => '2026-05-10',
        'placed_at' => '2026-05-09 09:00:00',
        'status' => OrderStatus::Confirmed,
        'confirmed_at' => now(),
    ]);
    $job = DeliveryJob::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'order_id' => $delivery->getKey(),
        'status' => 'pending',
        'tracking_status' => 'awaiting_assignment',
        'driver_user_id' => null,
        'assigned_at' => null,
        'lock_version' => 2,
    ]);

    $rows = collect($this->getJson('/api/v1/catalogue/orders', $this->headers)->assertOk()->json('data'))->keyBy('id');

    $paidRow = $rows[(string) $paid->getKey()];
    $deliveryRow = $rows[(string) $delivery->getKey()];

    expect($paidRow['payment'])->toBe([
        'method' => 'cash_on_delivery',
        'received_minor' => 1200,
        'receipted' => false,
    ])
        ->and($paidRow['delivery_job'])->toBeNull()
        // Absent, not null, for a reader who may not see contacts — the queue's rule.
        ->and($paidRow)->not->toHaveKey('customer')
        // The kitchen shape is all still there.
        ->and($paidRow)->toHaveKeys(['id', 'order_number', 'lock_version', 'delivery', 'lines'])
        ->and($deliveryRow['payment']['received_minor'])->toBe(0)
        ->and($deliveryRow['delivery_job']['id'])->toBe((string) $job->getKey())
        ->and($deliveryRow['delivery_job']['driver_user_id'])->toBeNull()
        ->and($deliveryRow['delivery_job']['lock_version'])->toBe(2);
});

it('serves the name and number to a caller who holds the contact code', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    $account = CustomerAccount::query()->find($this->customerId);
    $account->display_name = 'Nadia Haddad';
    $account->save();

    bookOrder($this, ['requested_delivery_date' => '2026-05-10']);

    $agent = bookAgent($this->orgId, 'agent-book@kitchen.test', [
        'order.view_organisation',
        'order.view_customer_contact_organisation',
    ]);

    forgetResolvedGuards();
    $this->actingAs($agent);

    $row = $this->getJson('/api/v1/catalogue/orders', $this->headers)->assertOk()->json('data.0');

    expect($row['customer']['display_name'])->toBe('Nadia Haddad')
        ->and(array_keys($row['customer']))->toBe(['display_name', 'phone']);
});

it('narrows to a span of days, putting an order with no day on the day it was placed', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-12 08:00:00', 'UTC'));

    $wanted = bookOrder($this, ['requested_delivery_date' => '2026-05-10', 'placed_at' => '2026-05-01 09:00:00']);
    // A counter sale: no requested day, so it is on the day it was placed.
    $counter = bookOrder($this, [
        'requested_delivery_date' => null,
        'delivery_window_code' => null,
        'placed_at' => '2026-05-10 13:00:00',
        'status' => OrderStatus::Fulfilled,
        'confirmed_at' => '2026-05-10 13:00:00',
        'fulfilled_at' => '2026-05-10 13:00:00',
    ], 'counter');
    // Placed on the day, wanted on another: not that day's work.
    bookOrder($this, ['requested_delivery_date' => '2026-05-11', 'placed_at' => '2026-05-10 15:00:00']);
    bookOrder($this, ['requested_delivery_date' => '2026-05-09', 'placed_at' => '2026-05-08 15:00:00']);

    $ids = $this->getJson('/api/v1/catalogue/orders?from=2026-05-10&to=2026-05-10', $this->headers)
        ->assertOk()
        ->json('data.*.id');

    expect($ids)->toEqualCanonicalizing([(string) $wanted->getKey(), (string) $counter->getKey()]);

    // Either end alone is a half-open span.
    expect($this->getJson('/api/v1/catalogue/orders?from=2026-05-10', $this->headers)->assertOk()->json('data'))
        ->toHaveCount(3)
        ->and($this->getJson('/api/v1/catalogue/orders?to=2026-05-09', $this->headers)->assertOk()->json('data'))
        ->toHaveCount(1);

    // A span that runs backwards, and a day written any other way, are refused.
    $this->getJson('/api/v1/catalogue/orders?from=2026-05-10&to=2026-05-09', $this->headers)->assertStatus(400);
    $this->getJson('/api/v1/catalogue/orders?from=tomorrow', $this->headers)->assertStatus(400);
});

it('narrows to a set of slots and to one way of leaving', function (): void {
    $lunch = bookOrder($this, ['requested_delivery_date' => '2026-05-10', 'delivery_window_code' => 'midday', 'fulfilment_type' => 'delivery']);
    $alsoLunch = bookOrder($this, ['requested_delivery_date' => '2026-05-10', 'delivery_window_code' => 'lunch'], 'pickup');
    bookOrder($this, ['requested_delivery_date' => '2026-05-10', 'delivery_window_code' => 'evening', 'fulfilment_type' => 'delivery']);

    $slot = $this->getJson('/api/v1/catalogue/orders?delivery_window_code[]=midday&delivery_window_code[]=lunch', $this->headers)
        ->assertOk()
        ->json('data.*.id');

    expect($slot)->toEqualCanonicalizing([(string) $lunch->getKey(), (string) $alsoLunch->getKey()]);

    $deliveries = $this->getJson('/api/v1/catalogue/orders?delivery_window_code[]=midday&delivery_window_code[]=lunch&fulfilment_type=delivery', $this->headers)
        ->assertOk()
        ->json('data.*.id');

    expect($deliveries)->toBe([(string) $lunch->getKey()]);

    $this->getJson('/api/v1/catalogue/orders?fulfilment_type=drone', $this->headers)->assertStatus(400);
});

it('serves a numbered page with its totals when a page is asked for', function (): void {
    foreach (range(1, 5) as $index) {
        bookOrder($this, [
            'requested_delivery_date' => '2026-05-10',
            'placed_at' => '2026-05-0'.$index.' 09:00:00',
            'created_at' => '2026-05-0'.$index.' 09:00:00',
        ]);
    }

    $second = $this->getJson('/api/v1/catalogue/orders?page=2&per_page=2', $this->headers)->assertOk();

    expect($second->json('data'))->toHaveCount(2)
        ->and($second->json('meta.page'))->toBe(2)
        ->and($second->json('meta.total_count'))->toBe(5)
        ->and($second->json('meta.total_pages'))->toBe(3);

    // Newest first, as the cursor walk is: page three holds the oldest.
    $third = $this->getJson('/api/v1/catalogue/orders?page=3&per_page=2', $this->headers)->assertOk();
    expect($third->json('data'))->toHaveCount(1)
        ->and($third->json('data.0.placed_at'))->toStartWith('2026-05-01');

    // A page past the end is a client bug, answered rather than served empty.
    $this->getJson('/api/v1/catalogue/orders?page=4&per_page=2', $this->headers)->assertStatus(400);
});
