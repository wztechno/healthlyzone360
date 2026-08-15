<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Placing an order, and the two audiences who then read it
|--------------------------------------------------------------------------
|
| `KitchenOrderIsolationTest` proves the seller filter really is the isolation
| boundary; `OrderSnapshotIntegrityTest` proves the frozen line survives a
| reformulation. This proves the HTTP surface in front of both: a placement, the
| customer's own history, the kitchen's book, and the one lifecycle action that
| needs an `If-Match`.
|
| It also proves the platform's **first genuinely non-idempotent command** is
| guarded, which is the part of this file worth the most: a double tap on a slow
| connection produces two orders for one intention, and the customer finds out
| when two couriers arrive.
|
| `CheckoutWorld` does not grant the `order.*` pair — it is a checkout fixture,
| and its kitchen manager holds the catalogue and pricing codes. The two are
| added here rather than to the shared world, so that every other suite building
| on it keeps a caller who cannot read a book they have no business reading.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('orders@kitchen.test');

    foreach (['order.view_organisation', 'order.manage_organisation'] as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $this->world->organisation->getKey(),
            'role_id' => $this->world->tenant->role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    $this->shopper = User::query()->whereKey($this->world->customer->account->user_id)->sole();
    $this->kitchenHeaders = firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->world->organisation->getKey()];
});

/**
 * A basket with one line of the world's meal, ready to become an order.
 *
 * Built through `CartService` rather than through `POST /carts`, the way
 * `OrderWorld` does: the cart routes are smoked by their own file, and an order
 * test that arranged its fixture over HTTP would fail for two reasons at once.
 */
function orderableCart(object $world): Cart
{
    $carts = app(CartService::class);

    $cart = $carts->getOrCreate($world->customer->account, $world->channel);
    $carts->addItem($cart, (string) $world->meal->getKey(), quantity: 2);

    return $cart->refresh();
}

it('places an order, serves it back to its customer, and lets the kitchen confirm it', function (): void {
    $this->actingAs($this->shopper);

    $cart = orderableCart($this->world);

    $placed = $this->postJson('/api/v1/orders', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.order.status', 'placed')
        ->assertJsonPath('data.order.currency_code', 'USD')
        ->assertJsonPath('data.order.line_count', 1)
        // 2 × 2500, plus the zone's 500 fee. Repriced at placement from the
        // tariff standing at that moment, never from a number the client sent.
        ->assertJsonPath('data.order.subtotal_minor', 5000)
        ->assertJsonPath('data.order.total_minor', 5500)
        ->assertJsonStructure(['data' => ['order' => ['id', 'order_number', 'delivery', 'lines']], 'meta' => ['correlation_id']]);

    $orderId = $placed->json('data.order.id');

    $this->getJson('/api/v1/me/orders', firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.0.id', $orderId)
        ->assertJsonPath('data.0.order_number', $placed->json('data.order.order_number'))
        ->assertJsonStructure(['data', 'meta' => ['correlation_id']]);

    $mine = $this->getJson('/api/v1/me/orders/'.$orderId, firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.order.id', $orderId)
        ->assertJsonStructure(['data' => ['order' => ['order_number', 'lines']], 'meta' => ['correlation_id']]);

    // The customer shape is built independently of the kitchen's rather than
    // being it with keys removed, and this is the difference showing: no
    // validator for a resource this audience cannot write, and no tariff
    // provenance on a receipt.
    expect($mine->json('data.order'))->not->toHaveKeys(['lock_version', 'organisation_id', 'created_by'])
        ->and($mine->json('data.order.lines.0'))->not->toHaveKeys(['price_list_id', 'price_list_item_id']);

    forgetResolvedGuards();
    $this->actingAs($this->world->tenant->user);

    $book = $this->getJson('/api/v1/catalogue/orders', $this->kitchenHeaders)
        ->assertOk()
        ->assertJsonPath('data.0.id', $orderId)
        ->assertJsonPath('data.0.status', 'placed')
        ->assertJsonStructure(['data' => [['order_number', 'lock_version', 'delivery']], 'meta' => ['correlation_id']]);

    $single = $this->getJson('/api/v1/catalogue/orders/'.$orderId, $this->kitchenHeaders)
        ->assertOk()
        ->assertJsonPath('data.order.id', $orderId)
        // The street is served whole to the kitchen: it is confidential and it
        // is also where the food has to go.
        ->assertJsonPath('data.order.delivery.line_one', 'Rue Gouraud 12')
        ->assertJsonPath('data.order.lock_version', $book->json('data.0.lock_version'));

    // The validator comes off the kitchen's own read, which is why that shape
    // carries one: a screen that could not read it could not send the `If-Match`
    // the lifecycle actions demand.
    $this->postJson('/api/v1/catalogue/orders/'.$orderId.'/confirm', [], $this->kitchenHeaders + [
        'If-Match' => '"'.$single->json('data.order.lock_version').'"',
    ])
        ->assertOk()
        ->assertJsonPath('data.order.status', 'confirmed')
        ->assertJsonPath('data.order.confirmed_at', fn (mixed $at): bool => is_string($at))
        ->assertHeader('ETag');
});

it('answers a replayed checkout with the order it already placed, and refuses a key that now means something else', function (): void {
    $this->actingAs($this->shopper);

    $cart = orderableCart($this->world);

    $body = [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ];

    $headers = firstPartyHeaders() + ['Idempotency-Key' => 'checkout-1'];

    $first = $this->postJson('/api/v1/orders', $body, $headers)
        ->assertCreated()
        ->assertHeaderMissing('Idempotency-Replayed');

    // The same intention, sent twice: one order, and the client is handed the
    // response it missed.
    //
    // **The status is the original `201`, not `200`, and that is a divergence
    // rather than a preference.** `EnforceIdempotency::replay()` reconstructs
    // the stored envelope status and all, so the controller's own
    // `PlacementResult::$replayed` branch — the thing that would answer `200` —
    // is never reached for the very requests that carry a key. Both
    // `docs/api/conventions.md` and the OpenAPI operation say a replay is
    // `200`; the `Idempotency-Key` parameter in the same document says the
    // status is replayed too. They cannot both be true of a command whose
    // fresh answer is `201`. Asserted as it behaves, and reported.
    $replay = $this->postJson('/api/v1/orders', $body, $headers)
        ->assertHeader('Idempotency-Replayed', 'true')
        ->assertJsonPath('data.order.order_number', $first->json('data.order.order_number'))
        ->assertJsonPath('data.order.id', $first->json('data.order.id'));

    expect($replay->getStatusCode())->toBe(201);

    expect(Order::query()->count())->toBe(1);

    // The same key against a different body is not a retry — it is a client
    // reusing a word that already means something — and the fix is a new key.
    $this->postJson('/api/v1/orders', $body + ['delivery_window_code' => 'evening'], $headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'request.idempotency_key_reused')
        ->assertJsonPath('error.details.idempotency_key', 'checkout-1')
        ->assertJsonStructure(['error' => ['code', 'message', 'details', 'correlation_id']]);

    expect(Order::query()->count())->toBe(1);
});
