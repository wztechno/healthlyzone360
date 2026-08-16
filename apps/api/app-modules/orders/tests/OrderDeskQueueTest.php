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
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The order desk queue: the sort, its three NULL levels, and who may see a name
|--------------------------------------------------------------------------
|
| `KitchenOrderIndexController` serves a *ledger* and this serves a *queue*, and
| the whole difference is one expression: the instant an order is due, computed
| across three tables from the day the customer asked for, the clock face of the
| delivery window they chose, and the timezone of the branch that cooks it.
|
| Almost everything that can go wrong with that expression is invisible for most
| of the year. An `AT TIME ZONE` applied in the wrong direction is right until a
| clock changes; a missing `COALESCE` drops every order nobody has named a day
| for, which is exactly the set nobody has committed to yet; a join on `code`
| without `organisation_id` reads one kitchen's vocabulary against another's
| rows. So this file pins the arithmetic rather than the endpoint's manners:
| a pair of orders either side of a British Summer Time transition whose true
| order is the reverse of their wall-clock order, all three NULL levels of the
| fallback chain, and the two-hundred-row cap that stands in for pagination the
| computed sort makes impossible.
|
| The two payment tests are a second piece of arithmetic, derived rather than
| stored: `received_minor` is a grouped sum over the receipts ledger and
| `receipted` is that sum against the order's total. Both failures they guard
| against read as a working screen — a lost `GROUP BY` puts the whole page's
| takings on every row, and `>` instead of `>=` shows a kitchen that has been
| paid in full as still owed the money — so the pair is pinned at the boundary
| and across two orders.
|
| The `delivery_job` tests are a third kind again: a *seat being filled*. The key
| was declared nullable and empty before anything could put a run in it, so the
| shape would not change under a client when C3 arrived; these pin that it is now
| populated for a confirmed delivery order — carrying the `lock_version` the
| Assign dialog sends back as `If-Match` — and still null for the three orders
| that legitimately have no run: a pickup, a counter sale, and a delivery nobody
| has confirmed yet. The isolation case matters more here than it looks, because
| the lookup is by order id across a whole page and a missing organisation
| predicate would decorate a row with another kitchen's dispatch.
|
| The last three tests are about disclosure rather than arithmetic. A desk row is
| the only kitchen-facing projection on this platform that carries a customer's
| name and telephone number, and `order.view_customer_contact_organisation` is
| the whole of what stands between them and everybody who can read the book. The
| absent-key assertion is the one worth keeping honest: without the code the
| field is **not there**, not there-and-null.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('desk@kitchen.test', ['order.view_organisation']);
    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->organisation, 'web-shop')->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();

    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];

    $this->actingAs($this->tenant->user);
});

/**
 * A branch of the kitchen on a stated clock. The timezone is the point of every
 * one of these — a branch is a place, and a place has a working day.
 */
function deskBranch(string $organisationId, string $timezone, string $name): OrganisationBranch
{
    return OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'name' => $name,
        'country_code' => 'LB',
        'city' => 'Beirut',
        'timezone' => $timezone,
        'status' => 'active',
        'lock_version' => 0,
    ]);
}

/**
 * A delivery window with a start and no end. Legal by design: the table's
 * time-order CHECK fires only when both ends are present, because a kitchen
 * that has named its slots before deciding their hours is a real half-finished
 * state — and `starts_at IS NULL` is the second of the three NULL levels the
 * due expression has to survive.
 */
function deskWindow(string $organisationId, string $code, ?string $startsAt): DeliveryWindow
{
    return DeliveryWindow::factory()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'starts_at' => $startsAt,
        'ends_at' => null,
    ]);
}

/**
 * An order on this kitchen's book. Built through the factory rather than
 * through placement: this suite is about how orders are *sorted*, and going
 * through `OrderPlacementService` would drag a priced channel, a served zone
 * and an eligible customer into a test that asserts none of them.
 *
 * @param  array<string, mixed>  $attributes
 */
function deskOrder(object $test, array $attributes = []): Order
{
    return Order::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        ...$attributes,
    ]);
}

/**
 * A second person inside the same kitchen, holding exactly the named codes.
 *
 * A second *organisation* would not do for the disclosure tests: the orders
 * have to be the same rows, so that the only difference between the two reads
 * is what the caller is allowed to see.
 *
 * @param  list<string>  $permissions
 */
function deskAgent(string $organisationId, string $email, array $permissions): User
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
 * @return list<string>
 */
function deskIds(object $test, string $queryString = ''): array
{
    /** @var list<string> $ids */
    $ids = $test->getJson('/api/v1/catalogue/order-desk/queue'.($queryString === '' ? '' : '?'.$queryString), $test->headers)
        ->assertOk()
        ->json('data.*.id');

    return $ids;
}

it('orders by the true instant, so a daylight-saving change reverses the wall clock', function (): void {
    // British Summer Time begins at 01:00 UTC on 2026-03-29. On the 28th
    // London is GMT and its wall clock *is* UTC; on the 29th it is BST and one
    // hour ahead of it. Two branches, identical windows, two days.
    $london = deskBranch($this->orgId, 'Europe/London', 'London');
    $reference = deskBranch($this->orgId, 'UTC', 'Reference');

    deskWindow($this->orgId, 'noon', '12:00:00');
    deskWindow($this->orgId, 'half-eleven', '11:30:00');

    $this->travelTo(CarbonImmutable::parse('2026-03-27 09:00:00', 'UTC'));

    $saturdayLondon = deskOrder($this, ['branch_id' => $london->getKey(), 'delivery_window_code' => 'noon', 'requested_delivery_date' => '2026-03-28']);
    $saturdayUtc = deskOrder($this, ['branch_id' => $reference->getKey(), 'delivery_window_code' => 'half-eleven', 'requested_delivery_date' => '2026-03-28']);
    $sundayLondon = deskOrder($this, ['branch_id' => $london->getKey(), 'delivery_window_code' => 'noon', 'requested_delivery_date' => '2026-03-29']);
    $sundayUtc = deskOrder($this, ['branch_id' => $reference->getKey(), 'delivery_window_code' => 'half-eleven', 'requested_delivery_date' => '2026-03-29']);

    $response = $this->getJson('/api/v1/catalogue/order-desk/queue?window=next_7', $this->headers)->assertOk();

    // Saturday's pair sorts the way the wall clock reads it — 11:30 before
    // 12:00 — because both clocks agree that day. Sunday's pair sorts the
    // *other* way round: London's noon is 11:00 UTC once the hour has gone
    // forward, which is half an hour before the 11:30 the reference branch is
    // still reading. A naive sort on (date, time) would have said
    // `$sundayUtc` first, and would have sent a kitchen to the wrong order.
    expect($response->json('data.*.id'))->toBe([
        (string) $saturdayUtc->getKey(),
        (string) $saturdayLondon->getKey(),
        (string) $sundayLondon->getKey(),
        (string) $sundayUtc->getKey(),
    ]);

    expect($response->json('data.*.due_at'))->toBe([
        '2026-03-28T11:30:00+00:00',
        '2026-03-28T12:00:00+00:00',
        '2026-03-29T11:00:00+00:00',
        '2026-03-29T11:30:00+00:00',
    ]);
});

it('falls through every NULL level of the due expression rather than dropping the row', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    $branch = deskBranch($this->orgId, 'UTC', 'Main');
    deskWindow($this->orgId, 'noon', '12:00:00');
    deskWindow($this->orgId, 'unhoured', null);

    // No requested day at all: the customer asked for it as soon as possible,
    // so the order is due from the moment they asked. It is `today`'s work.
    $undated = deskOrder($this, [
        'branch_id' => $branch->getKey(),
        'requested_delivery_date' => null,
        'placed_at' => '2026-05-10 06:00:00',
    ]);

    // No branch: nowhere to read a local clock, so UTC.
    $branchless = deskOrder($this, [
        'branch_id' => null,
        'delivery_window_code' => 'noon',
        'requested_delivery_date' => '2026-05-10',
    ]);

    // A window nobody has given hours to, and no window at all. Both fall to
    // the end of the requested day — late rather than early, because "some
    // time on Sunday" must not sort ahead of "nine on Sunday morning".
    $unhoured = deskOrder($this, [
        'branch_id' => $branch->getKey(),
        'delivery_window_code' => 'unhoured',
        'requested_delivery_date' => '2026-05-10',
        'placed_at' => '2026-05-10 07:00:00',
    ]);

    $windowless = deskOrder($this, [
        'branch_id' => $branch->getKey(),
        'delivery_window_code' => null,
        'requested_delivery_date' => '2026-05-10',
        'placed_at' => '2026-05-10 07:30:00',
    ]);

    $response = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk();

    expect($response->json('data.*.id'))->toBe([
        (string) $undated->getKey(),
        (string) $branchless->getKey(),
        // Tied at 23:59:59 and separated by `placed_at`, which is what stops a
        // screen polling every fifteen seconds from shuffling rows.
        (string) $unhoured->getKey(),
        (string) $windowless->getKey(),
    ])
        ->and($response->json('data.*.due_at'))->toBe([
            '2026-05-10T06:00:00+00:00',
            '2026-05-10T12:00:00+00:00',
            '2026-05-10T23:59:59+00:00',
            '2026-05-10T23:59:59+00:00',
        ])
        ->and($response->json('meta.truncated'))->toBeFalse()
        ->and($response->json('meta.count'))->toBe(4)
        ->and($response->json('meta.today'))->toBe('2026-05-10')
        ->and($response->json('meta.timezone'))->toBe('UTC');
});

it('reads today on the named branch\'s clock rather than the server\'s', function (): void {
    // 22:30 UTC on the 10th is already 01:30 on the 11th in Beirut, so the
    // branch's queue is the 11th's work. A server-clock day boundary would
    // show a kitchen yesterday's list for three hours every night.
    $this->travelTo(CarbonImmutable::parse('2026-05-10 22:30:00', 'UTC'));

    $beirut = deskBranch($this->orgId, 'Asia/Beirut', 'Beirut');

    $tomorrowThere = deskOrder($this, ['branch_id' => $beirut->getKey(), 'requested_delivery_date' => '2026-05-11']);
    deskOrder($this, ['branch_id' => $beirut->getKey(), 'requested_delivery_date' => '2026-05-10']);

    $response = $this->getJson('/api/v1/catalogue/order-desk/queue?branch_id='.$beirut->getKey(), $this->headers)->assertOk();

    expect($response->json('data.*.id'))->toBe([(string) $tomorrowThere->getKey()])
        ->and($response->json('meta.today'))->toBe('2026-05-11')
        ->and($response->json('meta.timezone'))->toBe('Asia/Beirut');
});

it('answers each window with the days it names, and only those', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    $yesterday = deskOrder($this, ['requested_delivery_date' => '2026-05-09']);
    $today = deskOrder($this, ['requested_delivery_date' => '2026-05-10']);
    $undated = deskOrder($this, ['requested_delivery_date' => null]);
    $inThree = deskOrder($this, ['requested_delivery_date' => '2026-05-13']);
    $lastDay = deskOrder($this, ['requested_delivery_date' => '2026-05-17']);
    deskOrder($this, ['requested_delivery_date' => '2026-05-18']);

    // Today, plus the orders nobody has named a day for: those are not
    // unscheduled, they are *now*.
    expect(deskIds($this))->toEqualCanonicalizing([(string) $today->getKey(), (string) $undated->getKey()]);

    // Overdue does not inherit that rule. A dateless order is never late,
    // because there is no day it has missed.
    expect(deskIds($this, 'window=overdue'))->toBe([(string) $yesterday->getKey()]);

    expect(deskIds($this, 'window=next_7'))->toBe([
        (string) $today->getKey(),
        (string) $inThree->getKey(),
        (string) $lastDay->getKey(),
    ]);
});

it('narrows on branch, status and delivery window without widening the queue', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    $branch = deskBranch($this->orgId, 'UTC', 'Main');
    $other = deskBranch($this->orgId, 'UTC', 'Second');
    deskWindow($this->orgId, 'morning', '09:00:00');
    deskWindow($this->orgId, 'evening', '18:00:00');

    $confirmedMorning = deskOrder($this, [
        'branch_id' => $branch->getKey(),
        'delivery_window_code' => 'morning',
        'requested_delivery_date' => '2026-05-10',
        'status' => OrderStatus::Confirmed,
    ]);

    $placedEvening = deskOrder($this, [
        'branch_id' => $branch->getKey(),
        'delivery_window_code' => 'evening',
        'requested_delivery_date' => '2026-05-10',
    ]);

    deskOrder($this, ['branch_id' => $other->getKey(), 'requested_delivery_date' => '2026-05-10']);

    // Neither of the two finished states belongs on a queue: they are the
    // order book's business, and it is paginated for the job.
    deskOrder($this, ['branch_id' => $branch->getKey(), 'requested_delivery_date' => '2026-05-10', 'status' => OrderStatus::Fulfilled]);
    deskOrder($this, [
        'branch_id' => $branch->getKey(),
        'requested_delivery_date' => '2026-05-10',
        'status' => OrderStatus::Cancelled,
        // `orders_cancellation_check` ties the status to the timestamp in both
        // directions, so the factory's bare status is not a legal row.
        'cancelled_at' => '2026-05-10 07:00:00',
    ]);

    expect(deskIds($this, 'branch_id='.$branch->getKey()))->toBe([
        (string) $confirmedMorning->getKey(),
        (string) $placedEvening->getKey(),
    ]);

    expect(deskIds($this, http_build_query(['branch_id' => (string) $branch->getKey(), 'status' => ['placed']])))
        ->toBe([(string) $placedEvening->getKey()]);

    expect(deskIds($this, 'delivery_window_code=morning'))
        ->toBe([(string) $confirmedMorning->getKey()]);
});

it('searches the order number and nothing else', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    $wanted = deskOrder($this, ['order_number' => 'H360-DESK-0042', 'requested_delivery_date' => '2026-05-10']);
    deskOrder($this, ['order_number' => 'H360-BOOK-0099', 'requested_delivery_date' => '2026-05-10']);

    // Case-insensitive and a substring, because the number arrives at a desk
    // spoken down a telephone rather than pasted.
    expect(deskIds($this, 'query=desk-0042'))->toBe([(string) $wanted->getKey()]);
    expect(deskIds($this, 'query=H360'))->toHaveCount(2);
});

it('caps the queue at two hundred rows and says when it did', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    Order::factory()->count(201)->create([
        'organisation_id' => $this->orgId,
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => $this->channelId,
        'requested_delivery_date' => '2026-05-10',
    ]);

    $response = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk();

    expect($response->json('data'))->toHaveCount(200)
        ->and($response->json('meta.count'))->toBe(200)
        ->and($response->json('meta.limit'))->toBe(200)
        // The screen has to be able to say "the first 200 of more". A silent
        // truncation would hide exactly the trouble the queue exists to show.
        ->and($response->json('meta.truncated'))->toBeTrue();
});

it('never shows one kitchen another kitchen\'s queue', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    $mine = deskOrder($this, ['requested_delivery_date' => '2026-05-10']);

    $neighbour = PricingWorld::kitchen('neighbour-desk@kitchen.test', ['order.view_organisation']);
    $theirs = Order::factory()->create([
        'organisation_id' => $neighbour->organisation->getKey(),
        'customer_account_id' => CustomerAccountFactory::new()->create()->getKey(),
        'sales_channel_id' => PricingWorld::channel($neighbour->organisation, 'web-shop')->getKey(),
        'requested_delivery_date' => '2026-05-10',
    ]);

    expect(deskIds($this))->toBe([(string) $mine->getKey()]);

    // Both directions: a filter that returned nothing to anybody would pass a
    // one-sided test.
    forgetResolvedGuards();
    $this->actingAs($neighbour->user);

    $ids = $this->getJson('/api/v1/catalogue/order-desk/queue', firstPartyHeaders() + [
        'X-Organisation-Id' => (string) $neighbour->organisation->getKey(),
    ])->assertOk()->json('data.*.id');

    expect($ids)->toBe([(string) $theirs->getKey()]);
});

it('sums an order\'s receipts and flips receipted at exactly the total', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    // A deposit and a balance: two rows against one order, which is the shape
    // the receipts ledger exists to allow. The factory's order totals 3000.
    $order = deskOrder($this, ['requested_delivery_date' => '2026-05-10']);

    OrderPaymentReceipt::factory()->create([
        'organisation_id' => $this->orgId,
        'order_id' => $order->getKey(),
        'confirmed_by' => $this->tenant->user->getKey(),
        'amount_minor' => 1200,
    ]);

    $row = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk()->json('data.0');

    // Part paid: the sum is real and `receipted` is still false, because a
    // deposit is not a settled order.
    expect($row['payment']['received_minor'])->toBe(1200)
        ->and($row['payment']['receipted'])->toBeFalse();

    // The balance lands the sum on the total exactly. The boundary is the
    // assertion worth having: `>=` and `>` differ on precisely this row, and a
    // kitchen that had been paid in full would be shown as owed money by the
    // wrong one.
    OrderPaymentReceipt::factory()->cashAtCounter()->create([
        'organisation_id' => $this->orgId,
        'order_id' => $order->getKey(),
        'confirmed_by' => $this->tenant->user->getKey(),
        'amount_minor' => 1800,
    ]);

    $row = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk()->json('data.0');

    expect($row['payment'])->toBe([
        // The order's *intended* method, unmoved by the counter-cash receipt
        // that settled it. Intent and arrival are two facts and the row keeps
        // them apart.
        'method' => 'cash_on_delivery',
        'received_minor' => 3000,
        'receipted' => true,
    ]);
});

it('keeps one order\'s receipts off another order\'s row', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    $paid = deskOrder($this, ['requested_delivery_date' => '2026-05-10', 'placed_at' => '2026-05-10 06:00:00']);
    $unpaid = deskOrder($this, ['requested_delivery_date' => '2026-05-10', 'placed_at' => '2026-05-10 07:00:00']);

    OrderPaymentReceipt::factory()->wish()->create([
        'organisation_id' => $this->orgId,
        'order_id' => $paid->getKey(),
        'confirmed_by' => $this->tenant->user->getKey(),
        'amount_minor' => 3000,
    ]);

    // The grouped aggregate is the thing under test: a sum that lost its
    // GROUP BY would put the whole page's takings on every row, and a page
    // where every order is paid looks exactly like a working screen.
    $rows = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk()->json('data');

    expect($rows[0]['id'])->toBe((string) $paid->getKey())
        ->and($rows[0]['payment']['received_minor'])->toBe(3000)
        ->and($rows[0]['payment']['receipted'])->toBeTrue()
        ->and($rows[1]['id'])->toBe((string) $unpaid->getKey())
        ->and($rows[1]['payment']['received_minor'])->toBe(0)
        ->and($rows[1]['payment']['receipted'])->toBeFalse();
});

it('carries the run a confirmed delivery order became, with the validator the assign dialog needs', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    $order = deskOrder($this, ['requested_delivery_date' => '2026-05-10', 'status' => OrderStatus::Confirmed, 'confirmed_at' => now()]);
    $driver = deskAgent($this->orgId, 'runner-desk@kitchen.test', ['order.view_organisation']);

    $job = DeliveryJob::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'order_id' => $order->getKey(),
        'status' => 'assigned',
        'tracking_status' => 'awaiting_assignment',
        'driver_user_id' => $driver->getKey(),
        'assigned_at' => now(),
        'lock_version' => 3,
    ]);

    $row = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk()->json('data.0');

    // Six fields and no address: everything about *where* the food is going is
    // already on the row's own `delivery` block, and a second copy inside the
    // job would be two answers to one question.
    expect($row['delivery_job'])->toBe([
        'id' => (string) $job->getKey(),
        'status' => 'assigned',
        'tracking_status' => 'awaiting_assignment',
        'driver_user_id' => (string) $driver->getKey(),
        'assigned_at' => '2026-05-10T08:00:00+00:00',
        // The `If-Match` the Assign dialog sends back, carried on the row it is
        // about so a desk never has to re-read the job to write to it.
        'lock_version' => 3,
    ]);
});

it('leaves the run null for a delivery order nobody has confirmed yet', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    // A job is projected on *confirm*, not on placement: a placed order may
    // still be cancelled without a driver ever hearing about it.
    deskOrder($this, ['requested_delivery_date' => '2026-05-10']);

    expect($this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk()->json('data.0.delivery_job'))
        ->toBeNull();
});

it('leaves the run null for pickup and counter orders', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    // Nobody drives these anywhere, so there is nothing to dispatch and the
    // absence is the fact rather than a gap.
    Order::factory()->pickup()->confirmed()->create([
        'organisation_id' => $this->orgId,
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => $this->channelId,
        'requested_delivery_date' => '2026-05-10',
        'placed_at' => '2026-05-10 06:00:00',
    ]);

    Order::factory()->counter()->confirmed()->create([
        'organisation_id' => $this->orgId,
        'sales_channel_id' => $this->channelId,
        'requested_delivery_date' => '2026-05-10',
        'placed_at' => '2026-05-10 07:00:00',
    ]);

    $jobs = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk()->json('data.*.delivery_job');

    expect($jobs)->toBe([null, null]);
});

it('keeps one kitchen\'s runs off another kitchen\'s queue rows', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    // The lookup is scoped by the organisation as well as by the order id — the
    // model's own global scope — so a job written against a foreign order can
    // never decorate a row here.
    $order = deskOrder($this, ['requested_delivery_date' => '2026-05-10', 'status' => OrderStatus::Confirmed, 'confirmed_at' => now()]);

    $foreign = PricingWorld::kitchen('foreign-desk@kitchen.test');

    DeliveryJob::withoutTenancy()->create([
        'organisation_id' => $foreign->organisation->getKey(),
        'order_id' => $order->getKey(),
        'status' => 'pending',
        'tracking_status' => 'awaiting_assignment',
        'lock_version' => 0,
    ]);

    expect($this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk()->json('data.0.delivery_job'))
        ->toBeNull();
});

it('withholds the customer\'s name and number from a caller without the contact code', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    deskOrder($this, ['requested_delivery_date' => '2026-05-10']);

    $row = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)
        ->assertOk()
        ->json('data.0');

    // Absent, not present-and-null. Null is a fact about the customer — "we
    // hold no number" — and a screen cannot tell that apart from a fact about
    // the reader unless the shapes differ.
    expect($row)->not->toHaveKey('customer')
        // Everything the order book serves is still here, and so is the queue's
        // own arithmetic: the permission withholds two fields, not the row.
        ->and($row)->toHaveKeys(['id', 'order_number', 'lock_version', 'delivery', 'lines', 'due_at', 'payment', 'delivery_job'])
        // The payment position is a fact about the order, not about the reader:
        // it is served to anybody who may read the queue at all. Nothing has
        // been paid here, and that is a zero rather than a null — an order whose
        // payment position is unknown is not a state this platform reaches.
        ->and($row['payment'])->toBe([
            'method' => 'cash_on_delivery',
            'received_minor' => 0,
            'receipted' => false,
        ])
        ->and($row['delivery_job'])->toBeNull();
});

it('serves the name and the callable number to a caller who holds the contact code', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    // A registered customer: the number hangs off the **identity**, which is
    // where a person's contacts live and survive every account they hold.
    $registered = CustomerAccount::query()->find($this->customerId);
    $registered->display_name = 'Nadia Haddad';
    $registered->save();

    ContactPoint::factory()->phone()->create([
        'user_id' => $registered->user_id,
        'is_primary' => true,
        // Unverified on purpose. A courier ringing about tonight's delivery
        // needs the number the customer gave, not one the platform has proved.
        'verified_at' => null,
    ]);

    // A guest: no user at all, so the number hangs off the **account**. Both
    // ownership arms have to resolve, or the desk shows a number for half the
    // customer base and null for the other half.
    $guest = CustomerAccountFactory::new()->guest()->create(['display_name' => 'Walk-in caller']);
    ContactPoint::factory()->phone()->forCustomerAccount((string) $guest->getKey())->create(['is_primary' => true]);

    $first = deskOrder($this, ['requested_delivery_date' => '2026-05-10', 'placed_at' => '2026-05-10 06:00:00']);
    $second = deskOrder($this, [
        'customer_account_id' => $guest->getKey(),
        'requested_delivery_date' => '2026-05-10',
        'placed_at' => '2026-05-10 07:00:00',
    ]);

    $agent = deskAgent($this->orgId, 'agent-desk@kitchen.test', [
        'order.view_organisation',
        'order.view_customer_contact_organisation',
    ]);

    forgetResolvedGuards();
    $this->actingAs($agent);

    $response = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk();

    expect($response->json('data.*.id'))->toBe([(string) $first->getKey(), (string) $second->getKey()])
        ->and($response->json('data.0.customer.display_name'))->toBe('Nadia Haddad')
        ->and($response->json('data.0.customer.phone'))->toBeString()
        ->and($response->json('data.0.customer.phone'))->toStartWith('+9611')
        ->and($response->json('data.1.customer.display_name'))->toBe('Walk-in caller')
        ->and($response->json('data.1.customer.phone'))->toStartWith('+9611')
        // Two fields and no more. No address beyond the delivery snapshot the
        // book already serves, no email, no account identifier to pivot on.
        ->and(array_keys($response->json('data.0.customer')))->toBe(['display_name', 'phone']);
});

it('serves a null number rather than falling over when the customer has none', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 08:00:00', 'UTC'));

    deskOrder($this, ['requested_delivery_date' => '2026-05-10']);

    $agent = deskAgent($this->orgId, 'agent-nophone@kitchen.test', [
        'order.view_organisation',
        'order.view_customer_contact_organisation',
    ]);

    forgetResolvedGuards();
    $this->actingAs($agent);

    $customer = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)
        ->assertOk()
        ->json('data.0.customer');

    expect($customer)->toHaveKeys(['display_name', 'phone'])
        ->and($customer['phone'])->toBeNull();
});
