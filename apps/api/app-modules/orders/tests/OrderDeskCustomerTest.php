<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The cold caller: writing down somebody who has never used the platform
|--------------------------------------------------------------------------
|
| Three surfaces and one rule between them, and the rule is the interesting
| part.
|
| **A `customer_accounts` row is not owned by a kitchen.** It carries no
| `organisation_id` unless it is a corporate buyer, because the same person
| orders from four kitchens with one account — so there is no column to scope on
| and no row-level-security predicate that could do this work. Worse: a
| staff-provisioned account has no user and no organisation, which is exactly the
| shape the policy's ownerless arm admits to *every* kitchen session. The
| migration says so rather than implying otherwise, and what stands between one
| kitchen and another kitchen's callers is the permission code plus
| `DeskCustomerDirectory`'s two-armed rule: an order with this kitchen, or
| provisioned by somebody holding an active membership of it.
|
| So the isolation assertions here are the load-bearing ones. They are
| application-layer by construction, and `OrderDeskCustomerRlsTest` proves the
| database half separately, under a role that cannot bypass a policy.
|
| The shape assertions come first because everything else rests on them: a `b2c`
| account with no user was illegal until this commit, and it has to stay illegal
| for every origin except `staff`.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('desk-customers@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'customer-agent@desk.test', [
        'order.view_organisation',
        'order.create_on_behalf_organisation',
        'order.view_customer_contact_organisation',
        'customer.create_on_behalf_organisation',
    ]);
    $this->headers = DeskWorld::headers($this->world);

    $this->actingAs($this->agent);
});

/**
 * A customer this desk provisioned, written straight to the table so a search
 * assertion is not built on the endpoint it is testing.
 *
 * Distinctively named for the reason every helper in this module is: Pest loads
 * the whole suite into one process, and a second file declaring
 * `provisionedCustomer()` would be a fatal redeclaration rather than a failure.
 */
function deskProvisionedCustomer(string $displayName, ?User $creator, ?string $phone = null): CustomerAccount
{
    $account = CustomerAccount::query()->create([
        'account_number' => 'H360-'.strtoupper(bin2hex(random_bytes(5))),
        'account_type' => CustomerAccountType::B2c,
        'user_id' => null,
        'organisation_id' => null,
        'status' => CustomerAccountStatus::Provisional,
        'origin' => CustomerAccountOrigin::Staff,
        'display_name' => $displayName,
        'provisional_expires_at' => null,
        'last_activity_at' => now(),
        'created_by' => $creator?->getKey(),
    ]);

    if ($phone !== null) {
        ContactPoint::factory()->create([
            'customer_account_id' => $account->getKey(),
            'user_id' => null,
            'channel' => 'phone',
            'value_normalised' => $phone,
            'value_hash' => hash('sha256', $phone),
            'is_primary' => true,
            'is_login_identity' => false,
            'source' => 'staff',
            'verified_at' => null,
        ]);
    }

    return $account;
}

/**
 * An order row for an account, enough to satisfy arm (a) of the scoping rule.
 */
function deskCustomerOrder(object $world, CustomerAccount $account): Order
{
    return Order::query()->create([
        'id' => app(IdentifierService::class)->generate(),
        'order_number' => 'ORD-'.strtoupper(bin2hex(random_bytes(5))),
        'organisation_id' => $world->organisation->getKey(),
        'customer_account_id' => $account->getKey(),
        'sales_channel_id' => $world->desk->getKey(),
        'status' => 'placed',
        'currency_code' => 'USD',
        'subtotal_minor' => 2500,
        'total_minor' => 2500,
        'delivery_line_one' => 'Rue Gouraud 12',
        'fulfilment_type' => 'delivery',
        'payment_method' => 'cash_on_delivery',
        'placed_at' => now(),
        'lock_version' => 0,
    ]);
}

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function deskCustomerBody(array $overrides = []): array
{
    return [
        'display_name' => 'Ramy Haddad',
        'phone' => '+96170123456',
        ...$overrides,
    ];
}

/**
 * @return array<string, string>
 */
function deskCustomerHeaders(object $test, string $key): array
{
    return $test->headers + ['Idempotency-Key' => $key];
}

it('admits a staff-provisioned consumer account with no user, and still refuses every other origin', function (): void {
    // The whole of what the migration widened, in two assertions. `staff` is the
    // arm; `self_service` is what the CHECK has always meant and still means.
    // Asserted by SQLSTATE **23514** rather than by message text, so a
    // PostgreSQL upgrade rewording its errors does not turn this green, and a
    // NOT NULL or a foreign key refusing the row for an unrelated reason does
    // not either.
    $staff = deskProvisionedCustomer('Provisional Caller', $this->agent);

    expect($staff->exists)->toBeTrue()
        ->and($staff->user_id)->toBeNull()
        // Not a guest, and the column that would have reaped them is empty.
        ->and($staff->account_type)->toBe(CustomerAccountType::B2c)
        ->and($staff->provisional_expires_at)->toBeNull();

    $refusal = fn () => DB::transaction(fn () => DB::table('customer_accounts')->insert([
        'id' => app(IdentifierService::class)->generate(),
        'account_number' => 'H360-'.strtoupper(bin2hex(random_bytes(5))),
        'account_type' => 'b2c',
        'user_id' => null,
        'organisation_id' => null,
        'status' => 'provisional',
        'origin' => 'self_service',
        'display_name' => 'Nobody At All',
        'lock_version' => 0,
        'created_at' => now(),
        'updated_at' => now(),
    ]));

    expect($refusal)->toThrow(function (QueryException $exception): void {
        expect($exception->getCode())->toBe('23514');
    });
});

it('will not answer a query too short to be a search', function (): void {
    // Two characters matches a meaningful fraction of any kitchen's customer
    // list, which is a directory dump wearing a search box. A 422 naming the
    // field rather than an empty list pretending nothing matched.
    $this->getJson('/api/v1/catalogue/order-desk/customers?query=ra', $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    $this->getJson('/api/v1/catalogue/order-desk/customers', $this->headers)->assertStatus(422);
});

it('finds a customer this kitchen has cooked for by a fragment of their name', function (): void {
    $customer = $this->world->customer->account;
    $customer->forceFill(['display_name' => 'Ramy Haddad'])->save();
    deskCustomerOrder($this->world, $customer);

    $response = $this->getJson('/api/v1/catalogue/order-desk/customers?query=hadd', $this->headers)
        ->assertOk();

    expect($response->json('data'))->toHaveCount(1)
        ->and($response->json('data.0.id'))->toBe((string) $customer->getKey())
        ->and($response->json('data.0.display_name'))->toBe('Ramy Haddad')
        ->and($response->json('data.0.has_orders_with_org'))->toBeTrue()
        ->and($response->json('data.0.origin'))->toBe('self_service')
        // The whole of the shape, and nothing else. An email or an account
        // number reaching this response would be a disclosure nobody decided
        // on.
        ->and(array_keys($response->json('data.0')))
        ->toEqualCanonicalizing(['id', 'display_name', 'phone', 'origin', 'has_orders_with_org']);
});

it('finds a customer by a telephone number typed the way a person says it', function (): void {
    // The bug this arm exists to avoid: `contact_points` stores E.164 and
    // nothing else, so a raw `+961 70 123-456` compared literally matches
    // nothing at all — and reads as "we have no such customer" rather than as a
    // bug. The search normalises through the same class the registry writes
    // through.
    $customer = deskProvisionedCustomer('Nour Khoury', $this->agent, '+96170123456');

    $response = $this->getJson(
        '/api/v1/catalogue/order-desk/customers?'.http_build_query(['query' => '+961 70 123-456']),
        $this->headers,
    )->assertOk();

    expect($response->json('data'))->toHaveCount(1)
        ->and($response->json('data.0.id'))->toBe((string) $customer->getKey())
        ->and($response->json('data.0.phone'))->toBe('+96170123456');
});

it('shows a customer this desk has just written down, before they have ordered anything', function (): void {
    // Arm (b) of the scoping rule, and the workflow it exists for: a caller
    // written down thirty seconds ago has no order yet, and a search scoped by
    // orders alone would lose them between the tap that creates them and the tap
    // that sells to them.
    $customer = deskProvisionedCustomer('Rita Aoun', $this->agent);

    $response = $this->getJson('/api/v1/catalogue/order-desk/customers?query=aoun', $this->headers)
        ->assertOk();

    expect($response->json('data'))->toHaveCount(1)
        ->and($response->json('data.0.id'))->toBe((string) $customer->getKey())
        ->and($response->json('data.0.origin'))->toBe('staff')
        ->and($response->json('data.0.has_orders_with_org'))->toBeFalse();
});

it('shows a kitchen nothing of a customer it has neither cooked for nor written down', function (): void {
    // Three strangers, one query, no matches — each one a different way the
    // scoping rule could have been got wrong.
    $otherWorld = DeskWorld::build('other-desk@kitchen.test');
    $otherAgent = DeskWorld::agent($otherWorld, 'other-agent@desk.test');

    // Provisioned by somebody who works at the *other* kitchen.
    deskProvisionedCustomer('Stranger Aoun', $otherAgent);

    // An ordinary registered consumer who has never ordered here.
    $registered = $this->world->customer->account;
    $registered->forceFill(['display_name' => 'Stranger Haddad'])->save();

    // Provisioned by nobody at all — an import, a fixture, a migration.
    deskProvisionedCustomer('Stranger Khoury', null);

    $response = $this->getJson('/api/v1/catalogue/order-desk/customers?query=stranger', $this->headers)
        ->assertOk();

    expect($response->json('data'))->toBe([]);
});

it('stops showing a customer whose provisioning agent no longer works here', function (): void {
    // `active`, not merely present. An ended employment is still a row in
    // `organisation_memberships`, and a former employee's callers are not this
    // kitchen's to read on the strength of it.
    //
    // The leaver is a *colleague* rather than the caller: ending the acting
    // agent's own membership would refuse the request at
    // `ResolveOrganisationContext` and prove nothing about the scoping rule.
    $colleague = DeskWorld::agent($this->world, 'leaver@desk.test', []);
    $customer = deskProvisionedCustomer('Leaver Fares', $colleague);

    $this->getJson('/api/v1/catalogue/order-desk/customers?query=fares', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.id', (string) $customer->getKey());

    OrganisationMembership::withoutTenancy()
        ->where('organisation_id', $this->world->organisation->getKey())
        ->where('user_id', $colleague->getKey())
        ->update(['status' => 'ended']);

    $this->getJson('/api/v1/catalogue/order-desk/customers?query=fares', $this->headers)
        ->assertOk()
        ->assertJsonPath('data', []);
});

it('refuses the search to a caller who may sell but may not read a stranger name', function (): void {
    // The split the two codes exist for. Selling to somebody already on file is
    // a smaller authority than reading back the names and numbers of people who
    // never spoke to you.
    $narrow = DeskWorld::agent($this->world, 'narrow-agent@desk.test', [
        'order.view_organisation',
        'order.create_on_behalf_organisation',
        'customer.create_on_behalf_organisation',
    ]);

    $this->actingAs($narrow)
        ->getJson('/api/v1/catalogue/order-desk/customers?query=anybody', $this->headers)
        ->assertStatus(403);
});

it('writes down a cold caller, their number, and who took the call', function (): void {
    $response = $this->postJson(
        '/api/v1/catalogue/order-desk/customers',
        deskCustomerBody(['preferred_language_code' => 'en', 'country_code' => 'LB']),
        deskCustomerHeaders($this, 'cold-caller-1'),
    )->assertCreated();

    $account = CustomerAccount::query()->where('origin', CustomerAccountOrigin::Staff)->sole();

    expect($response->json('data.customer.id'))->toBe((string) $account->getKey())
        ->and($response->json('data.customer.display_name'))->toBe('Ramy Haddad')
        ->and($response->json('data.customer.phone'))->toBe('+96170123456')
        ->and($response->json('data.customer.origin'))->toBe('staff')
        ->and($response->json('data.customer.has_orders_with_org'))->toBeFalse()
        ->and($response->json('data.possible_duplicates'))->toBe([])
        // A durable consumer account with no login, which the widened shape
        // CHECK is what admits.
        ->and($account->account_type)->toBe(CustomerAccountType::B2c)
        ->and($account->user_id)->toBeNull()
        ->and($account->organisation_id)->toBeNull()
        ->and($account->status)->toBe(CustomerAccountStatus::Provisional)
        // The purge reads this column, and a caller somebody took the trouble to
        // write down is not an abandoned sign-up.
        ->and($account->provisional_expires_at)->toBeNull()
        ->and($account->created_by)->toBe((string) $this->agent->getKey())
        ->and($account->preferred_language_code)->toBe('en')
        ->and($account->country_code)->toBe('LB');

    $contact = ContactPoint::query()->where('customer_account_id', $account->getKey())->sole();

    expect($contact->channel->value)->toBe('phone')
        ->and($contact->value_normalised)->toBe('+96170123456')
        // Heard over a telephone is provenance, not proof. `source` is the
        // column that records the difference, and marking it verified would let
        // a desk claim a number away from whoever really holds it.
        ->and($contact->source)->toBe('staff')
        ->and($contact->verified_at)->toBeNull()
        ->and($contact->is_primary)->toBeTrue()
        ->and($contact->user_id)->toBeNull()
        ->and($contact->created_by)->toBe((string) $this->agent->getKey());

    $audit = AuditLog::query()->where('action', 'customer.account_opened')->sole();

    expect($audit->subject_id)->toBe((string) $account->getKey())
        ->and($audit->actor_user_id)->toBe((string) $this->agent->getKey())
        ->and($audit->metadata['origin'])->toBe('staff');
});

it('will not write a customer down with no idempotency key at all', function (): void {
    // The `b2c` unique index is partial on `user_id`, and a staff-provisioned
    // row has none — so two taps are two perfectly legal people and no row
    // anywhere says which was the mistake. The key is the only guard there is.
    $this->postJson('/api/v1/catalogue/order-desk/customers', deskCustomerBody(), $this->headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid')
        ->assertJsonPath('error.details.header', 'Idempotency-Key');

    expect(CustomerAccount::query()->where('origin', CustomerAccountOrigin::Staff)->count())->toBe(0);
});

it('refuses a number the platform will not guess a country code for, and names the field', function (): void {
    $this->postJson(
        '/api/v1/catalogue/order-desk/customers',
        deskCustomerBody(['phone' => '70123456']),
        deskCustomerHeaders($this, 'unnormalisable-phone'),
    )
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        // `phone`, which is a field of this body — the registry would have said
        // `value`, which is not, and a screen highlighting a field that does not
        // exist is a form nobody can correct.
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['phone']]]]);

    expect(CustomerAccount::query()->where('origin', CustomerAccountOrigin::Staff)->count())->toBe(0);
});

it('creates the flatmate anyway, and says who else is on that number', function (): void {
    // Two customers genuinely do share a telephone — a household, a reception
    // desk, an office floor — and the unique index bites only *verified* rows,
    // so a second unverified one is legal. Refusing would make an existing
    // customer's flatmate unserveable, at a counter, with somebody waiting. So
    // the account is created and the duplicate is surfaced instead.
    $existing = deskProvisionedCustomer('Ramy Haddad', $this->agent, '+96170123456');

    $response = $this->postJson(
        '/api/v1/catalogue/order-desk/customers',
        deskCustomerBody(['display_name' => 'Nour Haddad']),
        deskCustomerHeaders($this, 'shared-house-phone'),
    )->assertCreated();

    expect($response->json('data.possible_duplicates'))->toHaveCount(1)
        ->and($response->json('data.possible_duplicates.0.id'))->toBe((string) $existing->getKey())
        ->and($response->json('data.possible_duplicates.0.display_name'))->toBe('Ramy Haddad')
        // Computed before the new row exists, so the new customer is never
        // listed as a duplicate of themselves.
        ->and($response->json('data.possible_duplicates.0.id'))->not->toBe($response->json('data.customer.id'))
        ->and(CustomerAccount::query()->where('origin', CustomerAccountOrigin::Staff)->count())->toBe(2);
});

it('says nothing about another kitchen customer sharing the number', function (): void {
    // A duplicate warning scoped to the platform would be an oracle over every
    // telephone number it holds.
    $otherWorld = DeskWorld::build('duplicate-oracle@kitchen.test');
    $otherAgent = DeskWorld::agent($otherWorld, 'oracle-agent@desk.test');

    deskProvisionedCustomer('Somebody Elsewhere', $otherAgent, '+96170123456');

    $this->postJson(
        '/api/v1/catalogue/order-desk/customers',
        deskCustomerBody(),
        deskCustomerHeaders($this, 'no-oracle'),
    )
        ->assertCreated()
        ->assertJsonPath('data.possible_duplicates', []);
});

it('gives a desk-provisioned customer somewhere for the food to go', function (): void {
    $customer = deskProvisionedCustomer('Rita Aoun', $this->agent);

    $response = $this->postJson(
        "/api/v1/catalogue/order-desk/customers/{$customer->getKey()}/addresses",
        [
            'delivery_area_id' => (string) $this->world->area->getKey(),
            'label' => 'Home',
            'line_one' => 'Rue Gouraud 12',
            'building' => 'Saifi',
            'floor' => '3',
            'directions' => 'Blue door beside the bakery.',
        ],
        $this->headers,
    )->assertCreated();

    $address = CustomerAddress::query()->where('customer_account_id', $customer->getKey())->sole();

    expect($response->json('data.address.id'))->toBe((string) $address->getKey())
        ->and($response->json('data.address.address_type'))->toBe('delivery')
        ->and($response->json('data.address.line_one'))->toBe('Rue Gouraud 12')
        // Recomputed on read rather than frozen at save time: coverage moves.
        ->and($response->json('data.address.is_deliverable'))->toBeTrue()
        // The service's own rule, unrelaxed for the desk — the first address of
        // a type is the default whether or not it was asked for.
        ->and($address->is_default)->toBeTrue()
        ->and($address->created_by)->toBe((string) $this->agent->getKey());
});

it('will not attach an address to an account this kitchen has no business with', function (): void {
    // The app-layer control the RLS migration names, on the endpoint where it
    // matters most: what this writes is a street somebody lives on. 404 rather
    // than 403, because confirming that an identifier exists but belongs to
    // somebody else is itself the disclosure.
    $otherWorld = DeskWorld::build('address-stranger@kitchen.test');
    $otherAgent = DeskWorld::agent($otherWorld, 'stranger-agent@desk.test');
    $stranger = deskProvisionedCustomer('Stranger Aoun', $otherAgent);

    $this->postJson(
        "/api/v1/catalogue/order-desk/customers/{$stranger->getKey()}/addresses",
        ['delivery_area_id' => (string) $this->world->area->getKey(), 'line_one' => 'Somewhere Else 4'],
        $this->headers,
    )
        ->assertStatus(404)
        ->assertJsonPath('error.code', 'resource.not_found');

    expect(CustomerAddress::query()->where('customer_account_id', $stranger->getKey())->count())->toBe(0);
});

it('passes the served-area refusal straight through from the address service', function (): void {
    $customer = deskProvisionedCustomer('Rita Aoun', $this->agent);
    $unserved = CheckoutWorld::area('nobody-delivers-here');

    $this->postJson(
        "/api/v1/catalogue/order-desk/customers/{$customer->getKey()}/addresses",
        ['delivery_area_id' => (string) $unserved->getKey(), 'line_one' => 'Rue Gouraud 12'],
        $this->headers,
    )
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'address.area_not_served')
        ->assertJsonPath('error.details.delivery_area_id', (string) $unserved->getKey());

    expect(CustomerAddress::query()->where('customer_account_id', $customer->getKey())->count())->toBe(0);
});

it('takes a telephone order for a caller who did not exist five minutes ago', function (): void {
    // The whole point of the commit, end to end: provision, address, sell — and
    // the sale goes through the eligibility gate that would refuse this account
    // on any other surface, because a provisional account with no verified email
    // satisfies none of the activation checklist. The member of staff on the
    // telephone is the verification it was asking for.
    $created = $this->postJson(
        '/api/v1/catalogue/order-desk/customers',
        deskCustomerBody(),
        deskCustomerHeaders($this, 'end-to-end-customer'),
    )->assertCreated();

    $customerId = (string) $created->json('data.customer.id');

    $address = $this->postJson(
        "/api/v1/catalogue/order-desk/customers/{$customerId}/addresses",
        ['delivery_area_id' => (string) $this->world->area->getKey(), 'line_one' => 'Rue Gouraud 12'],
        $this->headers,
    )->assertCreated();

    $order = $this->postJson('/api/v1/catalogue/order-desk/orders', [
        'fulfilment_type' => 'delivery',
        'payment_method' => 'cash_on_delivery',
        'customer_account_id' => $customerId,
        'customer_address_id' => (string) $address->json('data.address.id'),
        'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 2]],
    ], deskCustomerHeaders($this, 'end-to-end-sale'))->assertCreated();

    expect($order->json('data.order.customer_account_id'))->toBe($customerId)
        ->and($order->json('data.order.subtotal_minor'))->toBe(5000)
        ->and($order->json('data.order.delivery_fee_minor'))->toBe(500)
        ->and($order->json('data.order.total_minor'))->toBe(5500)
        ->and($order->json('data.order.placed_on_behalf_by'))->toBe((string) $this->agent->getKey());

    // And now they are searchable on arm (a) as well as arm (b) — a regular
    // rather than a name in the book.
    $this->getJson('/api/v1/catalogue/order-desk/customers?query=haddad', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.id', $customerId)
        ->assertJsonPath('data.0.has_orders_with_org', true);
});
