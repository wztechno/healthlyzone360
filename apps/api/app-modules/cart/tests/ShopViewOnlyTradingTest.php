<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\B2b\Tests\Fixtures\B2bCheckoutWorld;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The shop is view-only for anybody who belongs to an organisation
|--------------------------------------------------------------------------
|
| Kitchen staff and a business's people may look at the retail shop and buy
| nothing from it; a business still orders at its own prices on its wholesale
| channel. The client hides every Add from them — this is the server saying the
| same thing to a client that did not, `403 shop.view_only`.
|
| The rule is asked of the channel a basket was **opened on**, so a retail
| basket opened before its owner joined a kitchen is shut too. Removing a line
| is never refused: a shut basket can still be emptied.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('view-only@kitchen.test');
    $this->shopper = User::query()->whereKey($this->world->customer->account->user_id)->sole();
});

/** Make the world's customer a member of its kitchen — staff, from now on. */
function joinTheKitchen(object $world, string $status = 'active'): void
{
    OrganisationMembership::factory()->create([
        'organisation_id' => $world->organisation->getKey(),
        'user_id' => $world->customer->account->user_id,
        'status' => $status,
    ]);
}

it('refuses kitchen staff a retail basket', function (): void {
    joinTheKitchen($this->world);

    $this->actingAs($this->shopper)
        ->postJson('/api/v1/carts', [
            'channel_code' => 'web-shop',
            'kitchen_id' => (string) $this->world->organisation->getKey(),
        ], firstPartyHeaders())
        ->assertForbidden()
        ->assertJsonPath('error.code', 'shop.view_only')
        ->assertJsonPath('error.details.reasons.0.reason', 'shop_view_only');
});

it('lets a person whose membership has ended shop again', function (): void {
    joinTheKitchen($this->world, 'ended');

    $this->actingAs($this->shopper)
        ->postJson('/api/v1/carts', [
            'channel_code' => 'web-shop',
            'kitchen_id' => (string) $this->world->organisation->getKey(),
        ], firstPartyHeaders())
        ->assertOk();
});

it('shuts a retail basket opened before its owner joined a kitchen, but lets them empty it', function (): void {
    $carts = app(CartService::class);
    $cart = $carts->getOrCreate($this->world->customer->account, $this->world->channel);
    $line = $carts->addItem($cart, (string) $this->world->meal->getKey(), quantity: 1);

    joinTheKitchen($this->world);
    $this->actingAs($this->shopper);
    $cartUrl = '/api/v1/carts/'.$cart->getKey();

    $this->postJson($cartUrl.'/items', [
        'catalogue_item_id' => (string) $this->world->meal->getKey(),
        'quantity' => 1,
    ], firstPartyHeaders())
        ->assertForbidden()
        ->assertJsonPath('error.code', 'shop.view_only');

    $this->patchJson($cartUrl.'/items/'.$line->getKey(), ['quantity' => 3], firstPartyHeaders())
        ->assertForbidden()
        ->assertJsonPath('error.code', 'shop.view_only');

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertForbidden()
        ->assertJsonPath('error.code', 'shop.view_only');

    $this->postJson('/api/v1/orders', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertForbidden()
        ->assertJsonPath('error.code', 'shop.view_only');

    $this->deleteJson($cartUrl.'/items/'.$line->getKey(), [], firstPartyHeaders())
        ->assertNoContent();

    expect($cart->items()->count())->toBe(0);
});

it('refuses a corporate buyer the retail shop and keeps their wholesale channel open', function (): void {
    $wholesale = B2bCheckoutWorld::dualAgreement();
    $buyer = $wholesale['buyers']['acme'];
    $this->actingAs($buyer['user']);

    $this->postJson('/api/v1/carts', [
        'channel_code' => 'web-shop',
        'kitchen_id' => (string) $this->world->organisation->getKey(),
    ], $buyer['headers'])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'shop.view_only');

    $cartId = $this->postJson('/api/v1/carts', ['channel_code' => $wholesale['channel']->code], $buyer['headers'])
        ->assertOk()
        ->json('data.cart.id');

    $this->postJson('/api/v1/carts/'.$cartId.'/items', [
        'catalogue_item_id' => (string) $wholesale['meal']->getKey(),
        'quantity' => 2,
    ], $buyer['headers'])->assertCreated();

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => $cartId,
        'customer_address_id' => (string) $buyer['address']->getKey(),
    ], $buyer['headers'])
        ->assertOk()
        ->assertJsonPath('data.preview.subtotal_minor', 3600);
});
