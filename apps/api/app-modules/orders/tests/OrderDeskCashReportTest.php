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
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The day's takings: who took what, and the four ways that goes quietly wrong
|--------------------------------------------------------------------------
|
| The endpoint exists because this platform has no shift table. Nothing opens a
| drawer with a float or closes it against a count, so the most a manager can be
| given is attribution — what each agent wrote down as they took it. That makes
| the arithmetic below load-bearing in an unusual way: every failure it can have
| produces a *plausible* table rather than an error, and somebody would stand a
| cash box next to it.
|
| Four of those failures are pinned here.
|
| **Currencies summed together.** The grouping key is `(confirmed_by, method,
| currency_code)`, and the third part is the one that is easy to lose because it
| looks like an attribute of the group rather than part of its identity. Dropping
| it produces one row per agent per method carrying a number in no currency at
| all — which formats perfectly. So the first test gives one agent two currencies
| and asserts two rows and two totals, never a third that adds them.
|
| **The day boundary.** `confirmed_at` is an instant and a day is not; the report
| cuts on UTC because a receipt carries no branch and the order behind it may
| carry none either. A boundary read on the server's local zone, or an inclusive
| upper bound at 23:59:59, both look right until a receipt lands in the last
| minute of a day — so the fixture puts one receipt in each of the three
| interesting places and asserts which day owns it.
|
| **Branch narrowing.** A receipt has no branch, so the filter reaches through
| the order. The consequence worth pinning is the one the queue screen documents
| at length: an order with a NULL branch is *excluded* by a branch filter, which
| is right for "what did the Marina site take?" and would be a silent loss of
| money if it were ever the default.
|
| **Isolation and permission.** The receipts table carries its own
| `organisation_id` and no ambient scope, so the predicate is hand-written and a
| lost `where` would put another kitchen's takings under this kitchen's agents'
| names. And the report is a statement about *people*, one step above the order
| book everybody working a queue can read.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('cash@kitchen.test', [
        'order.view_organisation',
        'order.manage_organisation',
    ]);

    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->organisation, 'web-shop')->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();

    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];

    $this->actingAs($this->tenant->user);
});

/**
 * An order on this kitchen's book, built through the factory.
 *
 * The report never reads an order's money — it sums the receipts ledger — so
 * going through `OrderPlacementService` would drag a priced channel and a served
 * zone into a suite that asserts neither. The one column that matters here is
 * `branch_id`, which is what the narrowing reaches through.
 *
 * @param  array<string, mixed>  $attributes
 */
function cashOrder(object $test, array $attributes = []): Order
{
    return Order::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        ...$attributes,
    ]);
}

/**
 * A receipt asserting that money arrived, by whom and when.
 *
 * `confirmed_at` is passed explicitly on every call: it is the column the whole
 * report is cut on, and a default of `now()` would make the day boundary tests
 * depend on when the suite happened to run.
 */
function cashReceipt(
    object $test,
    Order $order,
    User $confirmedBy,
    PaymentMethod $method,
    int $amountMinor,
    string $currency,
    string $confirmedAt,
): OrderPaymentReceipt {
    return OrderPaymentReceipt::factory()->create([
        'organisation_id' => $test->orgId,
        'order_id' => $order->getKey(),
        'confirmed_by' => $confirmedBy->getKey(),
        'method' => $method,
        'amount_minor' => $amountMinor,
        'currency_code' => $currency,
        'confirmed_at' => CarbonImmutable::parse($confirmedAt, 'UTC'),
    ]);
}

/**
 * A named member of this kitchen, holding exactly the given codes.
 *
 * The name comes from `user_profiles` rather than `users`, which carries an
 * email and deliberately no name at all — the same join the driver picker makes
 * and for the same reason.
 *
 * @param  list<string>  $permissions
 */
function cashAgent(string $organisationId, string $email, ?string $givenName, array $permissions = []): User
{
    $user = User::factory()->create(['email' => $email]);

    if ($givenName !== null) {
        UserProfile::factory()->create([
            'user_id' => $user->getKey(),
            'given_name' => $givenName,
            'family_name' => 'Nasr',
        ]);
    }

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

it('groups the day by agent, method and currency, and never adds two currencies together', function (): void {
    $order = cashOrder($this);

    $sara = cashAgent($this->orgId, 'sara@kitchen.test', 'Sara');
    $omar = cashAgent($this->orgId, 'omar@kitchen.test', 'Omar');

    // Sara: two cash receipts in dollars — one group, summed — and one in
    // dirhams, which is a *different* group because the currency is part of the
    // key rather than a label on it.
    cashReceipt($this, $order, $sara, PaymentMethod::CashOnDelivery, 1_500, 'USD', '2026-05-10 09:00:00');
    cashReceipt($this, $order, $sara, PaymentMethod::CashOnDelivery, 2_500, 'USD', '2026-05-10 14:00:00');
    cashReceipt($this, $order, $sara, PaymentMethod::CashOnDelivery, 9_000, 'AED', '2026-05-10 15:00:00');
    // And a transfer, which is a third group again: same person, same currency,
    // different way the money turned up.
    cashReceipt($this, $order, $sara, PaymentMethod::Wish, 700, 'USD', '2026-05-10 16:00:00');

    cashReceipt($this, $order, $omar, PaymentMethod::CashAtCounter, 400, 'USD', '2026-05-10 11:00:00');

    $response = $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=2026-05-10', $this->headers)
        ->assertOk();

    $rows = $response->json('data.rows');

    // Four groups, named agents first and then a total order over the key —
    // Omar before Sara alphabetically, and Sara's three in method then currency
    // order.
    expect($rows)->toHaveCount(4)
        ->and($response->json('meta.count'))->toBe(4);

    $keyed = [];

    foreach ($rows as $row) {
        $keyed[$row['display_name'].'|'.$row['method'].'|'.$row['currency_code']] = $row;
    }

    expect($keyed)->toHaveKeys([
        'Omar Nasr|cash_at_counter|USD',
        'Sara Nasr|cash_on_delivery|AED',
        'Sara Nasr|cash_on_delivery|USD',
        'Sara Nasr|wish|USD',
    ])
        // Summed *within* the group, which is the only place it is legal.
        ->and($keyed['Sara Nasr|cash_on_delivery|USD']['amount_minor_sum'])->toBe(4_000)
        ->and($keyed['Sara Nasr|cash_on_delivery|USD']['receipt_count'])->toBe(2)
        // And emphatically not folded into the dollars beside it.
        ->and($keyed['Sara Nasr|cash_on_delivery|AED']['amount_minor_sum'])->toBe(9_000)
        ->and($keyed['Sara Nasr|cash_on_delivery|AED']['receipt_count'])->toBe(1);

    $totals = [];

    foreach ($response->json('data.totals') as $total) {
        $totals[$total['method'].'|'.$total['currency_code']] = $total;
    }

    // Four totals for four (method, currency) pairs — the cash rows across
    // both agents in dollars, the dirhams on their own, the counter cash, and
    // the transfer. Never fewer: folding any two would add across a boundary
    // the key exists to keep.
    expect($totals)->toHaveCount(4)
        ->and($totals['cash_on_delivery|USD']['amount_minor_sum'])->toBe(4_000)
        ->and($totals['cash_on_delivery|AED']['amount_minor_sum'])->toBe(9_000)
        ->and($totals['cash_at_counter|USD']['amount_minor_sum'])->toBe(400)
        ->and($totals['wish|USD']['amount_minor_sum'])->toBe(700)
        // No grand total anywhere, because there is no currency for one to be in.
        ->and(array_keys($response->json('data')))->toBe(['rows', 'totals']);
});

it('cuts the day on UTC, half-open, and says so', function (): void {
    $order = cashOrder($this);
    $agent = cashAgent($this->orgId, 'boundary@kitchen.test', 'Boundary');

    // The last instant of the ninth, the first of the tenth, and the first of
    // the eleventh. A boundary read on a local zone, or an inclusive upper bound
    // at 23:59:59, puts one of these on the wrong day — and the wrong day is a
    // reconciliation that is off by one shift.
    cashReceipt($this, $order, $agent, PaymentMethod::CashAtCounter, 100, 'USD', '2026-05-09 23:59:59');
    cashReceipt($this, $order, $agent, PaymentMethod::CashAtCounter, 200, 'USD', '2026-05-10 00:00:00');
    cashReceipt($this, $order, $agent, PaymentMethod::CashAtCounter, 400, 'USD', '2026-05-10 23:59:59');
    cashReceipt($this, $order, $agent, PaymentMethod::CashAtCounter, 800, 'USD', '2026-05-11 00:00:00');

    $response = $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=2026-05-10', $this->headers)
        ->assertOk();

    expect($response->json('data.rows'))->toHaveCount(1)
        ->and($response->json('data.rows.0.amount_minor_sum'))->toBe(600)
        ->and($response->json('data.rows.0.receipt_count'))->toBe(2)
        // Echoed rather than assumed: a table that did not say which midnight it
        // was cut on would be implying the reader's own.
        ->and($response->json('meta.timezone'))->toBe('UTC')
        ->and($response->json('meta.date'))->toBe('2026-05-10');

    // The neighbours, so that "600" cannot be a coincidence of two receipts
    // landing anywhere at all.
    expect(
        $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=2026-05-09', $this->headers)
            ->assertOk()
            ->json('data.rows.0.amount_minor_sum')
    )->toBe(100);

    expect(
        $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=2026-05-11', $this->headers)
            ->assertOk()
            ->json('data.rows.0.amount_minor_sum')
    )->toBe(800);
});

it('narrows through the order to a branch, and drops branchless orders when it does', function (): void {
    $branch = OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'name' => 'Marina',
        'country_code' => 'LB',
        'city' => 'Beirut',
        'timezone' => 'Asia/Beirut',
        'status' => 'active',
        'lock_version' => 0,
    ]);

    $agent = cashAgent($this->orgId, 'branchy@kitchen.test', 'Branchy');

    $atBranch = cashOrder($this, ['branch_id' => $branch->getKey()]);
    // An order delivered through an organisation-wide zone, which is what the
    // live book's real orders look like.
    $branchless = cashOrder($this, ['branch_id' => null]);

    cashReceipt($this, $atBranch, $agent, PaymentMethod::CashOnDelivery, 500, 'USD', '2026-05-10 10:00:00');
    cashReceipt($this, $branchless, $agent, PaymentMethod::CashOnDelivery, 300, 'USD', '2026-05-10 11:00:00');

    // Unnarrowed: both, because both are this kitchen's money.
    expect(
        $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=2026-05-10', $this->headers)
            ->assertOk()
            ->json('data.rows.0.amount_minor_sum')
    )->toBe(800);

    $narrowed = $this->getJson(
        '/api/v1/catalogue/order-desk/cash-report?date=2026-05-10&branch_id='.$branch->getKey(),
        $this->headers,
    )->assertOk();

    // The branchless order's money is **gone**, and that is the documented
    // consequence rather than a bug: this is "what did the Marina site take?",
    // which is why it is never the default.
    expect($narrowed->json('data.rows.0.amount_minor_sum'))->toBe(500)
        ->and($narrowed->json('meta.branch_id'))->toBe((string) $branch->getKey());
});

it('lists an agent who never completed a profile rather than losing their takings', function (): void {
    $order = cashOrder($this);

    $named = cashAgent($this->orgId, 'named@kitchen.test', 'Named');
    $nameless = cashAgent($this->orgId, 'nameless@kitchen.test', null);

    cashReceipt($this, $order, $named, PaymentMethod::CashAtCounter, 100, 'USD', '2026-05-10 09:00:00');
    cashReceipt($this, $order, $nameless, PaymentMethod::CashAtCounter, 250, 'USD', '2026-05-10 09:30:00');

    $rows = $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=2026-05-10', $this->headers)
        ->assertOk()
        ->json('data.rows');

    // Named first, nameless last — and the nameless row is *present*, because
    // dropping it to avoid a null would be losing cash from a reconciliation to
    // protect a formatting concern.
    expect($rows)->toHaveCount(2)
        ->and($rows[0]['display_name'])->toBe('Named Nasr')
        ->and($rows[1]['display_name'])->toBeNull()
        ->and($rows[1]['amount_minor_sum'])->toBe(250)
        ->and($rows[1]['confirmed_by'])->toBe((string) $nameless->getKey());
});

it('answers an empty day rather than a hole', function (): void {
    $response = $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=2026-05-10', $this->headers)
        ->assertOk();

    expect($response->json('data.rows'))->toBe([])
        ->and($response->json('data.totals'))->toBe([])
        ->and($response->json('meta.count'))->toBe(0)
        ->and($response->json('meta.branch_id'))->toBeNull();
});

it('refuses a request with no day, and a day that is not one', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/cash-report', $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['date']]]]);

    $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=10-05-2026', $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['date']]]]);
});

it('never counts another kitchen\'s takings', function (): void {
    $order = cashOrder($this);
    $agent = cashAgent($this->orgId, 'ours@kitchen.test', 'Ours');

    cashReceipt($this, $order, $agent, PaymentMethod::CashAtCounter, 500, 'USD', '2026-05-10 09:00:00');

    // A second kitchen with its own order, its own agent and its own money on
    // the same day. `order_payment_receipts` carries no ambient scope, so the
    // organisation predicate is hand-written — and a lost `where` would put this
    // money under our agents' names.
    $other = PricingWorld::kitchen('other-cash@kitchen.test', ['order.manage_organisation']);
    $otherOrgId = (string) $other->organisation->getKey();

    $otherOrder = Order::factory()->create([
        'organisation_id' => $otherOrgId,
        'customer_account_id' => CustomerAccountFactory::new()->create()->getKey(),
        'sales_channel_id' => PricingWorld::channel($other->organisation, 'web-shop')->getKey(),
    ]);

    OrderPaymentReceipt::factory()->create([
        'organisation_id' => $otherOrgId,
        'order_id' => $otherOrder->getKey(),
        'confirmed_by' => $other->user->getKey(),
        'method' => PaymentMethod::CashAtCounter,
        'amount_minor' => 9_999,
        'currency_code' => 'USD',
        'confirmed_at' => CarbonImmutable::parse('2026-05-10 09:00:00', 'UTC'),
    ]);

    $rows = $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=2026-05-10', $this->headers)
        ->assertOk()
        ->json('data.rows');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['amount_minor_sum'])->toBe(500);
});

it('refuses a reader who may see the order book but not manage it', function (): void {
    // The distinction the code carries: everybody working a queue holds
    // `order.view_organisation`, and this is a statement about *people* — who
    // took how much — which is one step above it.
    $viewer = cashAgent($this->orgId, 'viewer-cash@kitchen.test', 'Viewer', ['order.view_organisation']);

    forgetResolvedGuards();
    $this->actingAs($viewer);

    $this->getJson('/api/v1/catalogue/order-desk/cash-report?date=2026-05-10', $this->headers)
        ->assertForbidden();
});
