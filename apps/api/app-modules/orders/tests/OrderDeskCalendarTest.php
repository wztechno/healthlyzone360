<?php

declare(strict_types=1);

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The order desk calendar: three bases that must never become one number
|--------------------------------------------------------------------------
|
| The endpoint unions three books that mean three different things — an order
| somebody agreed to, a subscription day the generator has claimed and not yet
| ordered, and a day a weekday pattern *forecasts* — and the single most
| important property of the whole feature is that it never adds them up. They
| overlap: a projected day becomes a claim, a claim becomes an order, and the
| projection is optimistic about days a claim already exists for. A kitchen
| buying ingredients off a total would buy too much, once, at the end of a month
| in which nothing looked wrong.
|
| So the first test builds a day carrying all three at once and pins each of them
| at one — the arrangement in which a double-count is invisible in a total and
| obvious in three columns — and asserts that no `total` key exists anywhere in
| the response. That last assertion is the one that will fail if somebody adds a
| convenience field later, which is exactly when it should.
|
| The two bases that come through the port are pinned from opposite directions:
| a *paused* subscription forecasts nothing, because a paused arrangement
| delivers nothing until somebody resumes it and no date can be predicted for
| that; and a scheduled row that has already become an order is not counted twice
| because it is no longer `scheduled`.
|
| The window breakdown carries the null bucket, and it is a `null` code rather
| than a placeholder string on purpose: a code is a kitchen's own vocabulary, and
| any word this endpoint invented would be a word a kitchen could also have
| typed.
|
| The last group is the guard rails. The sixty-day cap is enforced by this
| controller and not inherited from the subscription-schedule endpoint's private
| constant, so it is pinned at the boundary in both directions. And the permission
| stack is pinned from the weaker side: a caller holding `order.view_organisation`
| alone must be refused, because this is the only route on the platform behind two
| codes and a middleware alias that silently deduped would turn the second one
| into decoration.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('calendar@kitchen.test', [
        'order.view_organisation',
        'subscription.view_organisation',
    ]);

    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->organisation, 'web-shop')->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();

    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];

    $this->actingAs($this->tenant->user);
});

/**
 * An order on this kitchen's book, on a named day.
 *
 * Built through the factory rather than through placement, on
 * `OrderDeskQueueTest`'s argument: this suite is about how days are *counted*,
 * and going through `OrderPlacementService` would drag a priced channel, a
 * served zone and an eligible customer into a test that asserts none of them.
 *
 * @param  array<string, mixed>  $attributes
 */
function calendarOrder(object $test, string $date, array $attributes = []): Order
{
    return Order::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        'requested_delivery_date' => $date,
        ...$attributes,
    ]);
}

/**
 * A standing arrangement, built from its columns rather than sold.
 *
 * `SubscriptionWorld` builds the real thing through `SubscriptionService`,
 * which is where the commercial invariants live — a priced plan, an offered
 * configuration, an activated customer, a duration assigned to a matrix cell.
 * None of that is what a calendar counts. What a calendar counts is a weekday
 * pattern, a balance and a status, so this fills the foreign keys with rows that
 * satisfy the constraints and states the three columns the projection actually
 * reads.
 *
 * @param  list<int>  $weekdays  ISO weekdays, 1 = Monday
 * @param  array<string, mixed>  $attributes
 */
function calendarSubscription(object $test, array $weekdays, array $attributes = []): Subscription
{
    $product = PricingWorld::product($test->tenant, 'Plan '.Str::random(6), 'cell-'.Str::lower(Str::random(6)));

    $accountId = (string) CustomerAccountFactory::new()->create()->getKey();

    $address = CustomerAddress::factory()->create(['customer_account_id' => $accountId]);

    $duration = PlanDuration::factory()->days(20)->create(['organisation_id' => $test->orgId]);

    return Subscription::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $accountId,
        'sales_channel_id' => $test->channelId,
        'catalogue_item_id' => $product->item->getKey(),
        'catalogue_item_variant_id' => $product->variant->getKey(),
        'plan_duration_id' => $duration->getKey(),
        'customer_address_id' => $address->getKey(),
        'currency_code' => $test->organisation->default_currency_code,
        'weekdays' => $weekdays,
        ...$attributes,
    ]);
}

/**
 * One claimed delivery day: the row generation writes before it places an
 * order, and the only shape the `scheduled` basis counts.
 *
 * @param  array<string, mixed>  $attributes
 */
function calendarDelivery(Subscription $subscription, string $date, array $attributes = []): SubscriptionDelivery
{
    return SubscriptionDelivery::query()->create([
        'subscription_id' => $subscription->getKey(),
        'organisation_id' => $subscription->organisation_id,
        'branch_id' => $subscription->branch_id,
        'delivery_date' => $date,
        'delivery_window_code' => $subscription->delivery_window_code,
        'status' => SubscriptionDeliveryStatus::Scheduled,
        'consumed' => false,
        ...$attributes,
    ]);
}

/**
 * A second person inside the same kitchen, holding exactly the named codes.
 *
 * A second *organisation* would not do for the permission test: the calendar has
 * to be the same days, so that the only difference between the two reads is what
 * the caller is allowed to see.
 *
 * @param  list<string>  $permissions
 */
function calendarAgent(string $organisationId, string $email, array $permissions): User
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

/**
 * @return array<string, mixed>
 */
function calendarDay(object $test, string $from, string $to, string $date, string $queryString = ''): array
{
    $days = $test->getJson(
        '/api/v1/catalogue/order-desk/calendar?from='.$from.'&to='.$to.($queryString === '' ? '' : '&'.$queryString),
        $test->headers,
    )->assertOk()->json('data.days');

    foreach ($days as $day) {
        if ($day['date'] === $date) {
            return $day;
        }
    }

    return [];
}

it('keeps a day carrying all three bases as three numbers, and publishes no total', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));

    // Monday the 11th. One order somebody placed, one subscription day the
    // generator has claimed, and one day a second subscription's Monday pattern
    // forecasts — three facts of three different kinds about the same square.
    calendarOrder($this, '2026-05-11', ['delivery_window_code' => 'morning']);

    $claimed = calendarSubscription($this, [1], ['delivery_window_code' => 'morning']);
    calendarDelivery($claimed, '2026-05-11');

    calendarSubscription($this, [1], ['delivery_window_code' => 'morning']);

    $response = $this->getJson('/api/v1/catalogue/order-desk/calendar?from=2026-05-11&to=2026-05-11', $this->headers)->assertOk();

    expect($response->json('data.days.0.date'))->toBe('2026-05-11')
        ->and($response->json('data.days.0.counts'))->toBe([
            'order' => 1,
            'scheduled' => 1,
            'projected' => 1,
        ])
        ->and($response->json('data.days.0.windows'))->toBe([
            ['code' => 'morning', 'counts' => ['order' => 1, 'scheduled' => 1, 'projected' => 1]],
        ])
        ->and($response->json('meta.from'))->toBe('2026-05-11')
        ->and($response->json('meta.to'))->toBe('2026-05-11')
        ->and($response->json('meta.day_count'))->toBe(1)
        ->and($response->json('meta.max_window_days'))->toBe(60);

    // The assertion the whole feature rests on. A `total` anywhere — on the day,
    // on a window, in meta — would be a forecast added to a fact, and the number
    // it produced would be wrong in a way no screen could detect.
    expect(json_encode($response->json()))->not->toContain('total');
});

it('projects nothing for a paused subscription', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));

    calendarSubscription($this, [1, 2, 3, 4, 5, 6, 7], ['delivery_window_code' => 'morning'])
        ->forceFill(['status' => 'paused', 'paused_at' => CarbonImmutable::now(), 'next_generation_date' => null])
        ->save();

    $day = calendarDay($this, '2026-05-11', '2026-05-17', '2026-05-11');

    expect($day['counts'])->toBe(['order' => 0, 'scheduled' => 0, 'projected' => 0])
        ->and($day['windows'])->toBe([]);
});

it('counts a cancelled order nowhere, and a fulfilled one on the day it left the kitchen', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));

    // The cancellation CHECK makes a status-only cancelled row illegal: the
    // status and the timestamp are one fact and the schema says so.
    calendarOrder($this, '2026-05-11', [
        'status' => OrderStatus::Cancelled,
        'cancelled_at' => CarbonImmutable::now(),
    ]);

    calendarOrder($this, '2026-05-12', ['status' => OrderStatus::Fulfilled]);
    calendarOrder($this, '2026-05-13', ['status' => OrderStatus::Confirmed]);

    // A day nobody named. It is the queue's *today* and it is nowhere on a
    // calendar: there is no square for an order with no date, and putting it on
    // today's would invent a commitment and then move it every midnight.
    calendarOrder($this, '2026-05-11', ['requested_delivery_date' => null]);

    expect(calendarDay($this, '2026-05-11', '2026-05-13', '2026-05-11')['counts']['order'])->toBe(0)
        ->and(calendarDay($this, '2026-05-11', '2026-05-13', '2026-05-12')['counts']['order'])->toBe(1)
        ->and(calendarDay($this, '2026-05-11', '2026-05-13', '2026-05-13')['counts']['order'])->toBe(1);
});

it('splits a day by window and gives the unslotted work a null code, last', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));

    calendarOrder($this, '2026-05-11', ['delivery_window_code' => 'noon']);
    calendarOrder($this, '2026-05-11', ['delivery_window_code' => 'noon']);
    calendarOrder($this, '2026-05-11', ['delivery_window_code' => 'evening']);

    // No window at all — a legitimate state on both tables, and the bucket a
    // placeholder string would have collided with a real code on.
    calendarOrder($this, '2026-05-11', ['delivery_window_code' => null]);

    $unslotted = calendarSubscription($this, [1], ['delivery_window_code' => null]);
    calendarDelivery($unslotted, '2026-05-11');

    $day = calendarDay($this, '2026-05-11', '2026-05-11', '2026-05-11');

    expect($day['counts'])->toBe(['order' => 4, 'scheduled' => 1, 'projected' => 0])
        // Named slots alphabetically, then the residue. The null bucket carries
        // its own two bases separately, exactly as a named one does.
        ->and($day['windows'])->toBe([
            ['code' => 'evening', 'counts' => ['order' => 1, 'scheduled' => 0, 'projected' => 0]],
            ['code' => 'noon', 'counts' => ['order' => 2, 'scheduled' => 0, 'projected' => 0]],
            ['code' => null, 'counts' => ['order' => 1, 'scheduled' => 1, 'projected' => 0]],
        ]);
});

it('keeps an all-digit window code a string', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));

    // A kitchen may call a slot `12`. The column is forty characters of its own
    // vocabulary, and PHP does not keep a numeric string as an array key — so a
    // bucket map built without a cast hands `12` back as an integer, sorts it by
    // a different rule and puts a JSON number where the schema promises a
    // string.
    calendarOrder($this, '2026-05-11', ['delivery_window_code' => '12']);
    calendarOrder($this, '2026-05-11', ['delivery_window_code' => 'noon']);

    $day = calendarDay($this, '2026-05-11', '2026-05-11', '2026-05-11');

    expect($day['windows'])->toBe([
        ['code' => '12', 'counts' => ['order' => 1, 'scheduled' => 0, 'projected' => 0]],
        ['code' => 'noon', 'counts' => ['order' => 1, 'scheduled' => 0, 'projected' => 0]],
    ])
        ->and($day['windows'][0]['code'])->toBeString();
});

it('counts a claimed day once and stops counting it when it becomes an order', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));

    $subscription = calendarSubscription($this, [1], ['delivery_window_code' => 'morning']);

    $order = calendarOrder($this, '2026-05-11', ['delivery_window_code' => 'morning']);

    // The row generation writes once the order exists: no longer a claim, and
    // the orders basis is already counting the order it became.
    calendarDelivery($subscription, '2026-05-11', [
        'status' => SubscriptionDeliveryStatus::Generated,
        'consumed' => true,
        'order_id' => $order->getKey(),
        'generated_at' => CarbonImmutable::now(),
        'settled_at' => CarbonImmutable::now(),
    ]);

    // A skipped day is not a delivery at all — it is the absence of one — so it
    // is neither claimed nor forecast.
    calendarDelivery($subscription, '2026-05-12', [
        'status' => SubscriptionDeliveryStatus::SkippedCustomer,
        'skip_reason' => 'customer_request',
        'settled_at' => CarbonImmutable::now(),
    ]);

    expect(calendarDay($this, '2026-05-11', '2026-05-12', '2026-05-11')['counts'])
        ->toBe(['order' => 1, 'scheduled' => 0, 'projected' => 0])
        ->and(calendarDay($this, '2026-05-11', '2026-05-12', '2026-05-12')['counts'])
        ->toBe(['order' => 0, 'scheduled' => 0, 'projected' => 0]);
});

it('narrows every basis to one production site', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));

    $mine = OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'name' => 'Achrafieh',
        'country_code' => 'LB',
        'city' => 'Beirut',
        'timezone' => 'Asia/Beirut',
        'status' => 'active',
        'lock_version' => 0,
    ]);

    $theirs = OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'name' => 'Hamra',
        'country_code' => 'LB',
        'city' => 'Beirut',
        'timezone' => 'Asia/Beirut',
        'status' => 'active',
        'lock_version' => 0,
    ]);

    calendarOrder($this, '2026-05-11', ['branch_id' => $mine->getKey()]);
    calendarOrder($this, '2026-05-11', ['branch_id' => $theirs->getKey()]);

    $here = calendarSubscription($this, [1], ['branch_id' => $mine->getKey()]);
    calendarDelivery($here, '2026-05-11');

    $there = calendarSubscription($this, [1], ['branch_id' => $theirs->getKey()]);
    calendarDelivery($there, '2026-05-11');

    // A second Monday subscription at each branch, so the forecast narrows too.
    calendarSubscription($this, [1], ['branch_id' => $mine->getKey()]);
    calendarSubscription($this, [1], ['branch_id' => $theirs->getKey()]);

    expect(calendarDay($this, '2026-05-11', '2026-05-11', '2026-05-11')['counts'])
        ->toBe(['order' => 2, 'scheduled' => 2, 'projected' => 2])
        ->and(calendarDay($this, '2026-05-11', '2026-05-11', '2026-05-11', 'branch_id='.$mine->getKey())['counts'])
        ->toBe(['order' => 1, 'scheduled' => 1, 'projected' => 1]);
});

it('shows one kitchen nothing of another kitchen\'s book', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));

    $other = PricingWorld::kitchen('rival@kitchen.test', ['order.view_organisation']);
    $otherOrgId = (string) $other->organisation->getKey();
    $otherChannelId = (string) PricingWorld::channel($other->organisation, 'web-shop')->getKey();

    Order::factory()->create([
        'organisation_id' => $otherOrgId,
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => $otherChannelId,
        'requested_delivery_date' => '2026-05-11',
    ]);

    // The rival's standing arrangement, on the rival's book. Its catalogue rows
    // are this kitchen's — no constraint couples them, and the column under test
    // is `subscriptions.organisation_id`.
    $rivalSubscription = calendarSubscription($this, [1], ['organisation_id' => $otherOrgId]);
    calendarDelivery($rivalSubscription, '2026-05-11', ['organisation_id' => $otherOrgId]);

    expect(calendarDay($this, '2026-05-11', '2026-05-11', '2026-05-11')['counts'])
        ->toBe(['order' => 0, 'scheduled' => 0, 'projected' => 0]);
});

it('answers a sixty-day window and refuses a sixty-first day', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));

    // Counted inclusively: the 11th of May to the 9th of July is sixty squares.
    $this->getJson('/api/v1/catalogue/order-desk/calendar?from=2026-05-11&to=2026-07-09', $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.day_count', 60);

    $this->getJson('/api/v1/catalogue/order-desk/calendar?from=2026-05-11&to=2026-07-10', $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.fields.to.0', 'The calendar window may not exceed 60 days.');
});

it('refuses a window that ends before it starts, and one with a missing end', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/calendar?from=2026-05-11&to=2026-05-10', $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['to']]]]);

    $this->getJson('/api/v1/catalogue/order-desk/calendar?from=2026-05-11', $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['to']]]]);
});

it('refuses a caller holding only one of the two codes', function (): void {
    $orderOnly = calendarAgent($this->orgId, 'order-only@kitchen.test', ['order.view_organisation']);

    forgetResolvedGuards();
    $this->actingAs($orderOnly);

    $this->getJson('/api/v1/catalogue/order-desk/calendar?from=2026-05-11&to=2026-05-11', $this->headers)
        ->assertForbidden();

    $subscriptionOnly = calendarAgent($this->orgId, 'subscription-only@kitchen.test', ['subscription.view_organisation']);

    forgetResolvedGuards();
    $this->actingAs($subscriptionOnly);

    // Refused from the other side too. The two codes stack as two middleware
    // instances of the same class, which survive Laravel's deduplication because
    // it compares the resolved string and the parameter differs.
    $this->getJson('/api/v1/catalogue/order-desk/calendar?from=2026-05-11&to=2026-05-11', $this->headers)
        ->assertForbidden();
});
