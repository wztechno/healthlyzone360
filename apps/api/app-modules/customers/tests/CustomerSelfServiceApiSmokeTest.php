<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Allergens\Database\Seeders\AllergenSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Consent\Database\Seeders\ConsentDefinitionSeeder;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Consumer self-service, over HTTP
|--------------------------------------------------------------------------
|
| One smoke per sub-family of the surface a customer manages about themselves:
| the account and its checklist, a destination, an address, the dietary
| declaration and the consent position. Every one of them answers in the
| envelope, and the checklist is asserted specifically because it is the field
| the whole onboarding screen is built from — an account served without it is an
| account a client cannot render a next step for.
|
| The world is `CheckoutWorld`'s, for one reason: `POST /me/addresses` checks
| coverage at save time and refuses an area nobody serves. A hand-built area
| would be an address the platform is right to reject, which would make the
| smoke test the refusal rather than the write.
|
| The consent definitions **are** seeded here, unlike the cart and order
| suites. Nothing in this file orders anything, so a required consent left
| outstanding costs nothing — and `POST /me/consents` has no meaning without a
| catalogue to grant from.
|
*/

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
        ConsentDefinitionSeeder::class,
        // The allergen vocabulary alone, not the whole kitchen reference layer:
        // `customer_allergen_declarations.allergen_code` is a real foreign key,
        // and the 213-row ingredient library beside it is nothing this file
        // reads.
        AllergenSeeder::class,
    ]);

    $this->world = CheckoutWorld::build('self-service@kitchen.test');

    // A person with a proven email and nothing else: the state somebody is in
    // the moment they finish registering.
    $this->user = User::factory()->create();
});

it('opens a customer account, answers 201 once, and serves the checklist with it', function (): void {
    $this->actingAs($this->user);

    $opened = $this->postJson('/api/v1/customer-account', [], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.account.account_type', CustomerAccountType::B2c->value)
        ->assertJsonPath('data.account.status', 'provisional')
        ->assertJsonStructure(['data' => ['account' => ['id', 'account_number', 'is_ready', 'outstanding', 'checklist']], 'meta' => ['correlation_id']]);

    // Every requirement, met or not — never only the ones outstanding, because
    // a list that showed only what is missing loses the sense of progress.
    expect(array_column($opened->json('data.account.checklist'), 'code'))->toBe([
        'account.email_unverified',
        'account.phone_unverified',
        'account.no_served_address',
        'account.dietary_declaration_missing',
        'account.consents_outstanding',
    ]);

    // Idempotent, and the status code is what says so.
    $this->postJson('/api/v1/customer-account', [], firstPartyHeaders())->assertOk();

    $this->getJson('/api/v1/customer-account', firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.account.id', $opened->json('data.account.id'))
        ->assertJsonPath('data.account.checklist.0.code', 'account.email_unverified')
        ->assertJsonPath('meta.correlation_id', fn (mixed $id): bool => is_string($id) && $id !== '');

    expect(CustomerAccount::query()->where('user_id', $this->user->getKey())->count())->toBe(1);
});

it('takes a destination, an address, a dietary declaration and a consent', function (): void {
    $this->actingAs($this->user);

    $this->postJson('/api/v1/customer-account', [], firstPartyHeaders())->assertCreated();

    $contact = $this->postJson('/api/v1/me/contacts', [
        'channel' => 'phone',
        // Already E.164: the normaliser refuses to guess a country code, because
        // guessing would send somebody else's handset a code for this account.
        'value' => '+96170123456',
        'label' => 'Mobile',
    ], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.contact.channel', 'phone')
        ->assertJsonStructure(['data' => ['contact' => ['id', 'channel']], 'meta' => ['correlation_id']]);

    // Declared, never proven: a surface that could write `verified_at` would
    // make every downstream check meaningless.
    expect(ContactPoint::query()->whereKey($contact->json('data.contact.id'))->value('verified_at'))->toBeNull();

    $this->postJson('/api/v1/me/addresses', [
        'address_type' => 'delivery',
        'delivery_area_id' => (string) $this->world->area->getKey(),
        'label' => 'Home',
        'line_one' => 'Rue Gouraud 12',
    ], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.address.label', 'Home')
        // The first address of a type becomes the default whether or not it was
        // asked for.
        ->assertJsonPath('data.address.is_default', true)
        ->assertJsonStructure(['data' => ['address' => ['id', 'address_type']], 'meta' => ['correlation_id']]);

    // PUT, and an empty allergen list is an answer rather than an omission —
    // which is why the rule is `present` rather than `sometimes`.
    $this->putJson('/api/v1/me/dietary-profile', [
        'allergens' => [['allergen_code' => 'sesame', 'severity' => 'anaphylaxis']],
        'exclusions' => [],
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.dietary_profile.allergens.0.allergen_code', 'sesame')
        ->assertJsonStructure(['data' => ['dietary_profile' => ['declared_at']], 'meta' => ['correlation_id']]);

    $account = CustomerAccount::query()->where('user_id', $this->user->getKey())->sole();

    expect(CustomerDietaryProfile::query()->where('customer_account_id', $account->getKey())->value('declared_at'))->not->toBeNull();

    // The grant answers with the caller's whole position, from the same builder
    // `GET /me/consents` uses, so the screen after the tick cannot disagree with
    // the screen before it.
    $granted = $this->postJson('/api/v1/me/consents', [
        'codes' => ['consent.terms', 'consent.privacy'],
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonStructure(['data' => [['code', 'version', 'status']], 'meta' => ['correlation_id', 'count']]);

    $position = collect($granted->json('data'))->keyBy('code');

    expect($position['consent.terms']['status'])->toBe('granted')
        ->and($position['consent.privacy']['status'])->toBe('granted')
        ->and($position['consent.marketing_email']['status'])->not->toBe('granted');
});

it('refuses a self-service write from somebody who has not opened an account', function (): void {
    // Not a 404 and not a validation failure: what is missing is a standing the
    // platform has not granted yet, and the code says exactly that so a client
    // can send the person to `POST /customer-account` rather than to a typo.
    $this->actingAs(User::factory()->create());

    $this->postJson('/api/v1/me/addresses', [
        'address_type' => 'delivery',
        'delivery_area_id' => (string) $this->world->area->getKey(),
        'line_one' => 'Rue Gouraud 12',
    ], firstPartyHeaders())
        ->assertForbidden()
        ->assertJsonPath('error.code', 'account.verification_required')
        ->assertJsonPath('error.details.account_opened', false)
        ->assertJsonStructure(['error' => ['code', 'message', 'details', 'correlation_id']]);
});
