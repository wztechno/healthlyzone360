<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| A registered customer's first call
|--------------------------------------------------------------------------
|
| The owner's request of 2 November. A registered consumer with no order here
| is out of the desk's rule and out of the row policy, so the only door is the
| number the caller read out. Nothing else opens it, least of all a name.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('registered-caller@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'registered-agent@desk.test', [
        'order.view_organisation',
        'order.create_on_behalf_organisation',
        'order.view_customer_contact_organisation',
        'customer.create_on_behalf_organisation',
    ]);
    $this->headers = DeskWorld::headers($this->world);

    $this->actingAs($this->agent);

    $this->caller = deskRegisteredConsumer('Rana Haddad', '+96170111222');
});

function deskRegisteredConsumer(string $displayName, string $phone): CustomerAccount
{
    $user = User::factory()->create();

    $account = CustomerAccount::query()->create([
        'account_number' => 'H360-'.strtoupper(bin2hex(random_bytes(5))),
        'account_type' => CustomerAccountType::B2c,
        'user_id' => $user->getKey(),
        'organisation_id' => null,
        'status' => CustomerAccountStatus::Provisional,
        'origin' => CustomerAccountOrigin::SelfService,
        'display_name' => $displayName,
        'provisional_expires_at' => now()->addDays(30),
        'last_activity_at' => now(),
    ]);

    ContactPoint::factory()->create([
        'customer_account_id' => null,
        'user_id' => $user->getKey(),
        'channel' => 'phone',
        'value_normalised' => $phone,
        'value_hash' => hash('sha256', $phone),
        'is_primary' => true,
        'is_login_identity' => false,
        'source' => 'self_service',
        'verified_at' => null,
    ]);

    return $account;
}

it('never finds a registered consumer with no tie here by name', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/customers?query=Rana', $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.count', 0);

    expect(DB::table('kitchen_customer_links')->count())->toBe(0);
});

it('finds them by their exact number, links them and audits the link', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/customers?query=%2B96170111222', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.id', (string) $this->caller->getKey())
        ->assertJsonPath('data.0.origin', 'self_service');

    expect(DB::table('kitchen_customer_links')->where('customer_account_id', $this->caller->getKey())->count())->toBe(1)
        ->and(AuditLog::query()->where('action', 'customer.desk_link_created')->count())->toBe(1);

    // The same number again changes nothing, and now the name finds them too.
    $this->getJson('/api/v1/catalogue/order-desk/customers?query=%2B96170111222', $this->headers)->assertOk();
    $this->getJson('/api/v1/catalogue/order-desk/customers?query=Rana', $this->headers)
        ->assertJsonPath('meta.count', 1);

    expect(AuditLog::query()->where('action', 'customer.desk_link_created')->count())->toBe(1);
});

it('keeps a linked caller out of the customer book', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/customers?query=%2B96170111222', $this->headers)->assertOk();

    $this->getJson('/api/v1/catalogue/customers/'.$this->caller->getKey(), $this->headers)
        ->assertNotFound();
});

it('reads a linked customer\'s allergies for the order, on the record, without the notes', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/customers?query=%2B96170111222', $this->headers)->assertOk();

    $profile = CustomerDietaryProfile::query()->create([
        'customer_account_id' => $this->caller->getKey(),
        'declares_no_allergens' => false,
        'declared_at' => now(),
    ]);

    CustomerAllergenDeclaration::query()->create([
        'customer_dietary_profile_id' => $profile->getKey(),
        'allergen_code' => 'milk',
        'severity' => 'anaphylaxis',
        'notes' => 'Private note',
        'declared_at' => now(),
    ]);

    $response = $this->getJson('/api/v1/catalogue/order-desk/customers/'.$this->caller->getKey().'/allergies', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.allergens.0.allergen_code', 'milk')
        ->assertJsonPath('data.allergens.0.severity', 'anaphylaxis');

    expect($response->getContent())->not->toContain('Private note')
        ->and(AuditLog::query()->where('action', 'customer.dietary_profile_read')->where('purpose_of_use', 'order_fulfilment')->count())->toBe(1);
});

it('answers 404 for the allergies of somebody outside the desk\'s rule', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/customers/'.$this->caller->getKey().'/allergies', $this->headers)
        ->assertNotFound();
});

it('tells "never asked" from "no allergens"', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/customers?query=%2B96170111222', $this->headers)->assertOk();

    $this->getJson('/api/v1/catalogue/order-desk/customers/'.$this->caller->getKey().'/allergies', $this->headers)
        ->assertJsonPath('data.declared', false)
        ->assertJsonPath('data.declares_no_allergens', false)
        ->assertJsonPath('data.allergens', []);
});
