<?php

declare(strict_types=1);

use App\Models\User;
use Carbon\CarbonInterface;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| The kitchen's customer book: GET /catalogue/customers and /{account}
|--------------------------------------------------------------------------
|
| A read-only reference list. Its rule is the desk's two arms plus a third —
| a corporate buyer holding a programme with this kitchen — and the third arm
| must stay read-only: the desk's write endpoints keep asking the two-arm
| `isInScope()`. Both halves are asserted here; the database half of the read
| arm is `OrderDeskCustomerRlsTest`'s.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('customer-book@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'book-reader@desk.test', [
        'order.view_organisation',
        'order.view_customer_contact_organisation',
        'customer.create_on_behalf_organisation',
    ]);
    $this->headers = DeskWorld::headers($this->world);

    $this->actingAs($this->agent);
});

function bookStaffCustomer(string $displayName, ?User $creator, ?string $phone = null): CustomerAccount
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
        bookPhone($account, $phone);
    }

    return $account;
}

function bookPhone(CustomerAccount $account, string $phone, array $overrides = []): ContactPoint
{
    return ContactPoint::factory()->create([
        'customer_account_id' => $account->getKey(),
        'user_id' => null,
        'channel' => 'phone',
        'value_normalised' => $phone,
        'value_hash' => hash('sha256', $phone),
        'is_primary' => true,
        'is_login_identity' => false,
        'source' => 'staff',
        'verified_at' => null,
        ...$overrides,
    ]);
}

function bookOrder(object $world, CustomerAccount $account, ?CarbonInterface $placedAt = null): Order
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
        'placed_at' => $placedAt ?? now(),
        'lock_version' => 0,
    ]);
}

/**
 * A corporate buyer's trading account, its approved application with two named
 * contacts (one purged), and a programme with the given kitchen.
 */
function bookProgrammeClient(object $world, string $name = 'Acme Foods SAL'): CustomerAccount
{
    // The kitchen's own reference data: the factory's random country, currency
    // and language collide with the seeded ones.
    $kitchen = $world->organisation;
    $buyer = Organisation::factory()->create([
        'name' => $name,
        'organisation_type_id' => $kitchen->organisation_type_id,
        'country_code' => $kitchen->country_code,
        'default_currency_code' => $kitchen->default_currency_code,
        'default_language_code' => $kitchen->default_language_code,
    ]);

    $account = CustomerAccount::query()->create([
        'account_number' => 'H360-'.strtoupper(bin2hex(random_bytes(5))),
        'account_type' => CustomerAccountType::B2b,
        'user_id' => null,
        'organisation_id' => $buyer->getKey(),
        'status' => CustomerAccountStatus::Active,
        'origin' => CustomerAccountOrigin::B2bProvisioning,
        'display_name' => $name,
        'activated_at' => now(),
        'last_activity_at' => now(),
    ]);

    $application = B2bApplication::factory()->create([
        'status' => ApplicationStatus::Approved,
        'submitted_at' => now(),
        'decided_at' => now(),
        'country_code' => $kitchen->country_code,
        'legal_name' => $name,
        'trading_name' => 'Acme',
        'commercial_registration_number' => 'CR-778899',
        'commercial_registration_normalised' => 'CR778899',
        'tax_registration_number' => 'VAT-112233',
        'provisioned_organisation_id' => $buyer->getKey(),
        'customer_account_id' => $account->getKey(),
    ]);

    B2bApplicationContact::query()->create([
        'b2b_application_id' => $application->getKey(),
        'role' => 'billing',
        'name' => 'Nadine Billing',
        'email' => 'billing@acme.test',
    ]);
    B2bApplicationContact::query()->create([
        'b2b_application_id' => $application->getKey(),
        'role' => 'operations',
        'name' => 'Purged Person',
        'email' => null,
        'phone' => null,
        'purged_at' => now(),
    ]);

    CorporateProgramme::factory()->create([
        'organisation_id' => $buyer->getKey(),
        'kitchen_organisation_id' => $kitchen->getKey(),
        'b2b_agreement_id' => B2bAgreement::factory()->create([
            'b2b_application_id' => $application->getKey(),
            'currency_code' => $kitchen->default_currency_code,
        ])->getKey(),
    ]);

    return $account;
}

/** @return list<string> */
function bookIds(TestResponse $response): array
{
    return array_map(static fn (array $row): string => $row['id'], $response->json('data'));
}

it('lists who ordered here, who the staff wrote down, and programme clients — and nobody else', function (): void {
    $ordered = $this->world->customer->account;
    bookOrder($this->world, $ordered);
    $written = bookStaffCustomer('Rita Aoun', $this->agent);
    $client = bookProgrammeClient($this->world);

    $other = DeskWorld::build('other-book@kitchen.test');
    $otherAgent = DeskWorld::agent($other, 'other-book-agent@desk.test');
    bookStaffCustomer('Stranger Aoun', $otherAgent);
    bookOrder($other, bookStaffCustomer('Stranger Haddad', null));
    bookProgrammeClient($other, 'Elsewhere Corp');

    $response = $this->getJson('/api/v1/catalogue/customers', $this->headers)->assertOk();

    expect(bookIds($response))->toEqualCanonicalizing([
        (string) $ordered->getKey(),
        (string) $written->getKey(),
        (string) $client->getKey(),
    ])
        ->and($response->json('meta.total'))->toBe(3)
        ->and($response->json('meta.truncated'))->toBeFalse();
});

it("drops a former employee's callers", function (): void {
    $colleague = DeskWorld::agent($this->world, 'book-leaver@desk.test', []);
    $customer = bookStaffCustomer('Leaver Fares', $colleague);

    expect(bookIds($this->getJson('/api/v1/catalogue/customers', $this->headers)))
        ->toContain((string) $customer->getKey());

    OrganisationMembership::withoutTenancy()
        ->where('organisation_id', $this->world->organisation->getKey())
        ->where('user_id', $colleague->getKey())
        ->update(['status' => 'ended']);

    expect(bookIds($this->getJson('/api/v1/catalogue/customers', $this->headers)))
        ->not->toContain((string) $customer->getKey());
});

it('filters by type, by a name fragment, and by a full phone number', function (): void {
    $rita = bookStaffCustomer('Rita Aoun', $this->agent, '+96170123456');
    bookStaffCustomer('Karim Haddad', $this->agent);
    $client = bookProgrammeClient($this->world);

    expect(bookIds($this->getJson('/api/v1/catalogue/customers?type=b2b', $this->headers)))
        ->toBe([(string) $client->getKey()])
        ->and(bookIds($this->getJson('/api/v1/catalogue/customers?query=ao', $this->headers)))
        ->toBe([(string) $rita->getKey()])
        ->and(bookIds($this->getJson('/api/v1/catalogue/customers?query=%2B96170123456', $this->headers)))
        ->toBe([(string) $rita->getKey()]);

    $this->getJson('/api/v1/catalogue/customers?type=vip', $this->headers)->assertUnprocessable();
});

it('caps the book at 200 rows and says how many there really are', function (): void {
    foreach (range(1, 201) as $index) {
        bookStaffCustomer("Caller {$index}", $this->agent);
    }

    $response = $this->getJson('/api/v1/catalogue/customers', $this->headers)->assertOk();

    expect($response->json('data'))->toHaveCount(200)
        ->and($response->json('meta.count'))->toBe(200)
        ->and($response->json('meta.total'))->toBe(201)
        ->and($response->json('meta.truncated'))->toBeTrue();
});

it('orders by last order here, the never-ordered last, newest account first among equals', function (): void {
    $old = bookStaffCustomer('Old Order', $this->agent);
    bookOrder($this->world, $old, now()->subDays(5));
    $recent = bookStaffCustomer('Recent Order', $this->agent);
    bookOrder($this->world, $recent, now()->subDay());

    $this->travel(1)->minutes();
    $neverOlder = bookStaffCustomer('Never Older', $this->agent);
    $this->travel(1)->minutes();
    $neverNewer = bookStaffCustomer('Never Newer', $this->agent);

    expect(bookIds($this->getJson('/api/v1/catalogue/customers', $this->headers)))->toBe([
        (string) $recent->getKey(),
        (string) $old->getKey(),
        (string) $neverNewer->getKey(),
        (string) $neverOlder->getKey(),
    ]);
});

it('shows each kitchen only its own order count and last order for a shared customer', function (): void {
    $this->freezeSecond();

    $shared = $this->world->customer->account;
    $other = DeskWorld::build('shared-book@kitchen.test');
    $otherAgent = DeskWorld::agent($other, 'shared-book-agent@desk.test', [
        'order.view_customer_contact_organisation',
    ]);

    bookOrder($this->world, $shared, now()->subDays(3));
    bookOrder($other, $shared, now()->subDay());
    bookOrder($other, $shared, now()->subHours(2));

    $here = $this->getJson('/api/v1/catalogue/customers', $this->headers)->assertOk();
    expect($here->json('data.0.order_count'))->toBe(1)
        ->and($here->json('data.0.last_ordered_at'))->toBe(now()->subDays(3)->utc()->startOfSecond()->toIso8601String());

    $there = $this->actingAs($otherAgent)
        ->getJson('/api/v1/catalogue/customers', DeskWorld::headers($other))
        ->assertOk();
    expect($there->json('data.0.order_count'))->toBe(2)
        ->and($there->json('data.0.last_ordered_at'))->toBe(now()->subHours(2)->utc()->startOfSecond()->toIso8601String());
});

it('reads contacts on both ownership arms and leaves retired ones out', function (): void {
    $account = $this->world->customer->account;
    bookOrder($this->world, $account);

    // The fixture's user-owned verified email, plus an account-owned phone and
    // a retired one.
    bookPhone($account, '+96170111222');
    bookPhone($account, '+96170999999', ['is_primary' => false, 'retired_at' => now()]);

    $response = $this->getJson("/api/v1/catalogue/customers/{$account->getKey()}", $this->headers)
        ->assertOk();

    $values = array_column($response->json('data.contacts'), 'value');
    $userEmail = ContactPoint::query()->where('user_id', $account->user_id)->value('value_normalised');

    expect($values)->toContain('+96170111222')
        ->and($values)->toContain($userEmail)
        ->and($values)->not->toContain('+96170999999')
        ->and($response->json('data.primary_phone'))->toBe('+96170111222')
        ->and($response->json('data.primary_email'))->toBe($userEmail)
        ->and($response->json('data.addresses.0.line_one'))->toBe('Rue Gouraud 12')
        ->and($response->json('data.company'))->toBeNull();
});

it("carries a corporate buyer's company record and live contacts", function (): void {
    $client = bookProgrammeClient($this->world);

    $response = $this->getJson("/api/v1/catalogue/customers/{$client->getKey()}", $this->headers)
        ->assertOk();

    expect($response->json('data.account_type'))->toBe('b2b')
        ->and($response->json('data.company.organisation_name'))->toBe('Acme Foods SAL')
        ->and($response->json('data.company.commercial_registration_number'))->toBe('CR-778899')
        ->and($response->json('data.company.tax_registration_number'))->toBe('VAT-112233')
        ->and($response->json('data.company.contacts'))->toHaveCount(1)
        ->and($response->json('data.company.contacts.0.name'))->toBe('Nadine Billing');
});

it('answers 404 for an account outside the book, and for a malformed identifier', function (): void {
    $other = DeskWorld::build('outside-book@kitchen.test');
    $stranger = bookStaffCustomer('Stranger', DeskWorld::agent($other, 'outside-agent@desk.test'));

    $this->getJson("/api/v1/catalogue/customers/{$stranger->getKey()}", $this->headers)->assertNotFound();
    $this->getJson('/api/v1/catalogue/customers/not-a-uuid', $this->headers)->assertNotFound();
});

it('refuses the book to somebody without the contact code, and to a request with no kitchen', function (): void {
    $narrow = DeskWorld::agent($this->world, 'narrow-book@desk.test', ['order.view_organisation']);

    $this->actingAs($narrow)
        ->getJson('/api/v1/catalogue/customers', $this->headers)
        ->assertForbidden();

    $this->actingAs($this->agent)
        ->getJson('/api/v1/catalogue/customers', firstPartyHeaders())
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'context.organisation_required');
});

it('keeps a programme-only client out of the desk search and away from its writes', function (): void {
    $client = bookProgrammeClient($this->world, 'Deskless Corp');

    $this->getJson('/api/v1/catalogue/order-desk/customers?query=deskless', $this->headers)
        ->assertOk()
        ->assertJsonPath('data', []);

    $this->patchJson(
        "/api/v1/catalogue/order-desk/customers/{$client->getKey()}",
        ['display_name' => 'Rewritten', 'phone' => '+96170000003'],
        $this->headers,
    )->assertNotFound();

    $this->postJson(
        "/api/v1/catalogue/order-desk/customers/{$client->getKey()}/addresses",
        ['delivery_area_id' => (string) $this->world->area->getKey(), 'line_one' => 'Somewhere 1'],
        $this->headers,
    )->assertNotFound();

    expect($client->fresh()?->display_name)->toBe('Deskless Corp');
});
