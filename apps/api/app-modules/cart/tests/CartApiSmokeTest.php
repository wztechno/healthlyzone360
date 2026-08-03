<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Enums\CartStatus;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Models\CartItem;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The basket, over HTTP
|--------------------------------------------------------------------------
|
| Open, add, adjust, remove — the four writes a shopper makes and the only four
| the routing table offers. `CrossCurrencyRefusalTest` proves what the service
| refuses; this proves the wire in front of it works at all, in the envelope,
| with the status codes the family's docblocks argue for: 200 for a get-or-create
| that is not a creation, 201 for a line even when it merged, 204 for a removal
| that carries no representation to validate.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('basket@kitchen.test');
    $this->shopper = User::query()->whereKey($this->world->customer->account->user_id)->sole();

    $this->actingAs($this->shopper);
});

it('opens one basket per channel, fills it, adjusts it and empties it', function (): void {
    $opened = $this->postJson('/api/v1/carts', [
        // A code, never an identifier: a shopper knows they are buying through
        // the web shop and does not hold a channel UUID.
        'channel_code' => $this->world->channel->code,
    ], firstPartyHeaders())
        // 200, not 201. Get-or-create is not a creation, and a client that saw
        // 201 twice would reasonably conclude it had two baskets.
        ->assertOk()
        ->assertJsonPath('data.cart.status', 'open')
        ->assertJsonPath('data.cart.currency_code', 'USD')
        ->assertJsonPath('data.cart.line_count', 0)
        ->assertJsonStructure(['data' => ['cart' => ['id', 'lock_version', 'expires_at', 'lines']], 'meta' => ['correlation_id']])
        ->assertHeader('ETag');

    $cartId = $opened->json('data.cart.id');

    expect($this->postJson('/api/v1/carts', ['channel_code' => $this->world->channel->code], firstPartyHeaders())
        ->assertOk()
        ->json('data.cart.id'))->toBe($cartId);

    $line = $this->postJson('/api/v1/carts/'.$cartId.'/items', [
        'catalogue_item_id' => (string) $this->world->meal->getKey(),
        'quantity' => 2,
    ], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.line.catalogue_item_id', (string) $this->world->meal->getKey())
        ->assertJsonPath('data.line.quantity', '2.0000')
        // The whole basket comes back beside the line: the write moved the
        // validator and pushed the expiry out, so a client holding only the line
        // would be holding two stale facts.
        ->assertJsonPath('data.cart.line_count', 1)
        ->assertJsonStructure(['data' => ['line' => ['id'], 'cart' => ['lock_version']], 'meta' => ['correlation_id']]);

    $lineId = $line->json('data.line.id');

    $this->patchJson('/api/v1/carts/'.$cartId.'/items/'.$lineId, [
        // Set, never adjust. A delta applied to a basket that changed underneath
        // the client produces a number nobody asked for.
        'quantity' => 5,
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.line.quantity', '5.0000')
        ->assertJsonPath('data.cart.line_count', 1)
        ->assertJsonPath('meta.correlation_id', fn (mixed $id): bool => is_string($id) && $id !== '');

    // 204, and therefore no ETag: the validator did move, and serving one for a
    // representation this response does not contain is how a client ends up
    // confident about a basket it has not seen.
    $this->deleteJson('/api/v1/carts/'.$cartId.'/items/'.$lineId, [], firstPartyHeaders())
        ->assertNoContent()
        ->assertHeaderMissing('ETag');

    expect(CartItem::query()->where('cart_id', $cartId)->count())->toBe(0)
        ->and(Cart::query()->whereKey($cartId)->value('status'))->toBe(CartStatus::Open)
        ->and(Cart::query()->where('customer_account_id', $this->world->customer->account->getKey())->count())->toBe(1);
});
