<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Guest\Enums\GuestSessionGrade;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Buying without an account, end to end
|--------------------------------------------------------------------------
|
| The named happy path of G1, walked over HTTP with nothing but a header: an
| anonymous request earns a token, a passcode earns the `place_order` grade, and
| the grade earns an order. Three credential regimes appear in one file — none,
| `X-Guest-Token` at `checkout_draft`, and `X-Guest-Token` at `place_order` —
| which is the whole reason the routing table declares them beside the paths.
|
| **No `auth:sanctum` and no session anywhere in here.** A guest is a member of
| nothing and holds no user, so `firstPartyHeaders()` would be describing a
| credential this journey does not have.
|
| `expose_codes` is on, which is `OtpService::exposesCodes()`'s testing-only
| affordance: the plaintext exists between generation and delivery and nowhere
| else, and the alternative — reading the row — would find only an HMAC.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    config()->set('verification.otp.expose_codes', true);

    $this->world = CheckoutWorld::build('guest@kitchen.test');
});

/**
 * The token header, which is this journey's entire credential.
 *
 * Its own header rather than `Authorization`, so a client holding both a
 * personal access token and a guest token cannot silently send the wrong one.
 *
 * @return array<string, string>
 */
function guestHeaders(string $token): array
{
    return ['X-Guest-Token' => $token];
}

it('takes an anonymous browser from no credential at all to a placed order', function (): void {
    $started = $this->postJson('/api/v1/guest/sessions', ['preferred_language_code' => 'en', 'country_code' => 'LB'])
        ->assertCreated()
        ->assertJsonPath('data.grade', GuestSessionGrade::CheckoutDraft->value)
        ->assertJsonPath('data.customer_account.account_type', 'guest')
        ->assertJsonPath('data.customer_account.origin', 'guest')
        ->assertJsonStructure(['data' => ['token', 'expires_at', 'account_expires_at', 'customer_account' => ['id']], 'meta' => ['correlation_id']]);

    $token = $started->json('data.token');
    $accountId = $started->json('data.customer_account.id');

    // A guest account is a `customer_accounts` row with no user, which is the
    // shape the table's CHECK constraint already enforced before G1 existed.
    expect(CustomerAccount::query()->whereKey($accountId)->value('user_id'))->toBeNull();

    $challenge = $this->postJson('/api/v1/guest/contacts', [
        'channel' => 'email',
        'value' => 'hungry-guest@example.test',
    ], guestHeaders($token))
        // 202: a challenge is a message in flight, not a resource the caller may
        // then read.
        ->assertStatus(202)
        ->assertJsonPath('data.challenge.purpose', 'guest_order')
        ->assertJsonStructure(['data' => ['challenge' => ['challenge_id', 'destination_masked', 'expires_at']], 'meta' => ['correlation_id']]);

    $this->postJson('/api/v1/guest/contacts/verify', [
        'challenge_id' => $challenge->json('data.challenge.challenge_id'),
        'code' => $challenge->json('data.challenge.debug_code'),
    ], guestHeaders($token))
        ->assertOk()
        // The one act that raises a grade, and the only one that can:
        // `guest_sessions_grade_proof_check` refuses the higher grade without
        // the timestamp this writes.
        ->assertJsonPath('data.session.grade', GuestSessionGrade::PlaceOrder->value)
        ->assertJsonPath('data.session.contact_verified', true)
        ->assertJsonStructure(['data' => ['session' => ['id'], 'customer_account' => ['id']], 'meta' => ['correlation_id']]);

    // The resume read: a token that has been sitting in local storage since
    // yesterday, and the only honest way to find out whether it still works.
    // It never echoes the credential back.
    $resumed = $this->getJson('/api/v1/guest/session', guestHeaders($token))
        ->assertOk()
        ->assertJsonPath('data.session.grade', GuestSessionGrade::PlaceOrder->value)
        ->assertJsonStructure(['data' => ['session' => ['id', 'expires_at'], 'customer_account' => ['id']], 'meta' => ['correlation_id']]);

    expect($resumed->json('data.session'))->not->toHaveKeys(['token', 'token_hash', 'ip_hash', 'user_agent_hash']);

    $account = CustomerAccount::query()->whereKey($accountId)->sole();

    // The basket and the address are built directly: `POST /carts` is behind
    // `auth:sanctum` and a guest holds no session, so G1's client fills a guest
    // basket through the same service and there is no HTTP route here to smoke.
    $carts = app(CartService::class);
    $cart = $carts->getOrCreate($account, $this->world->channel);
    $carts->addItem($cart, (string) $this->world->meal->getKey(), quantity: 1);

    $address = CustomerAddress::query()->create([
        'customer_account_id' => $account->getKey(),
        'address_type' => CustomerAddressType::Delivery,
        'delivery_area_id' => $this->world->area->getKey(),
        'label' => 'Home',
        'line_one' => 'Rue Gouraud 12',
        'is_default' => true,
        'lock_version' => 0,
    ]);

    $placed = $this->postJson('/api/v1/guest/orders', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $address->getKey(),
    ], guestHeaders($token))
        ->assertCreated()
        ->assertJsonPath('data.order.status', 'placed')
        ->assertJsonPath('data.order.currency_code', 'USD')
        ->assertJsonPath('data.order.total_minor', 3000)
        ->assertJsonPath('meta.replayed', false)
        ->assertJsonStructure(['data' => ['order' => ['id', 'order_number', 'lines']], 'meta' => ['correlation_id']]);

    $orderId = $placed->json('data.order.id');

    $read = $this->getJson('/api/v1/guest/orders/'.$orderId, guestHeaders($token))
        ->assertOk()
        ->assertJsonPath('data.order.id', $orderId)
        ->assertJsonPath('data.order.order_number', $placed->json('data.order.order_number'));

    // One server-chosen name, never both language columns (§4.8), and no
    // validator for a resource a guest has no write surface on.
    expect($read->json('data.order.lines.0'))->toHaveKey('name')
        ->and($read->json('data.order.lines.0'))->not->toHaveKeys(['name_en', 'name_ar'])
        ->and($read->json('data.order'))->not->toHaveKey('lock_version')
        ->and(Order::query()->where('customer_account_id', $account->getKey())->count())->toBe(1);
});

it('acknowledges an erasure request identically for an address it holds and one it has never seen', function (): void {
    // The enumeration property, asserted at the HTTP layer.
    // `GuestDeletionEnumerationTest` asserts it on the service's whole
    // serialised result; this asserts that the wire does not reintroduce a
    // difference the service refused to make — a status code, a header or a key
    // that only a known address produces would be the same oracle in a new place.
    $started = $this->postJson('/api/v1/guest/sessions')->assertCreated();

    $this->postJson('/api/v1/guest/contacts', [
        'channel' => 'email',
        'value' => 'known-guest@example.test',
    ], guestHeaders($started->json('data.token')))->assertStatus(202);

    // The same length, so even the server-authored mask differs only in the one
    // character the caller typed themselves.
    $known = $this->postJson('/api/v1/guest/deletion-requests', ['channel' => 'email', 'value' => 'known-guest@example.test'])
        ->assertStatus(202)
        ->assertJsonPath('data.accepted', true)
        ->assertJsonPath('data.verification_required', true);

    $unknown = $this->postJson('/api/v1/guest/deletion-requests', ['channel' => 'email', 'value' => 'other-guest@example.test'])
        ->assertStatus(202);

    expect(array_keys($known->json('data')))->toBe(array_keys($unknown->json('data')))
        ->and(array_diff_key($known->json('data'), ['destination_masked' => null]))
        ->toEqual(array_diff_key($unknown->json('data'), ['destination_masked' => null]))
        ->and($known->json('data.destination_masked'))->toBe('k••••••••••@example.test')
        ->and($unknown->json('data.destination_masked'))->toBe('o••••••••••@example.test');
});
