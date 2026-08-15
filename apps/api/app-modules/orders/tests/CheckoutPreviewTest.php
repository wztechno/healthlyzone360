<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\DeliveryArea;

/*
|--------------------------------------------------------------------------
| A real server-side checkout preview
|--------------------------------------------------------------------------
|
| `POST /checkouts/preview` runs the same `LineProbe` and `ZoneResolver`
| paths `OrderApiSmokeTest` proves `OrderPlacementService` runs at placement,
| so the numbers asserted here are the same numbers that test asserts on the
| placed order — 2 × 2500 subtotal, the world's 500 delivery fee.
|
| Every case is a 200 carrying warnings rather than an error, except the two
| ownership checks, which answer exactly as `OrderLocator` answers them for
| placement: a cart or an address that is not the caller's own is
| `resource.not_found`.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('preview@kitchen.test');
    $this->shopper = User::query()->whereKey($this->world->customer->account->user_id)->sole();
});

function previewableCart(object $world): Cart
{
    $carts = app(CartService::class);

    $cart = $carts->getOrCreate($world->customer->account, $world->channel);
    $carts->addItem($cart, (string) $world->meal->getKey(), quantity: 2);

    return $cart->refresh();
}

it('prices the basket and the address zone together, honestly', function (): void {
    $this->actingAs($this->shopper);

    $cart = previewableCart($this->world);

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.cart_id', (string) $cart->getKey())
        ->assertJsonPath('data.preview.currency_code', 'USD')
        // 2 × 2500, matching what `OrderApiSmokeTest` places this same world for.
        ->assertJsonPath('data.preview.subtotal_minor', 5000)
        ->assertJsonPath('data.preview.delivery_fee_minor', 500)
        ->assertJsonPath('data.preview.total_minor', 5500)
        ->assertJsonPath('data.preview.line_count', 1)
        ->assertJsonPath('data.preview.warnings', [])
        ->assertJsonStructure(['data' => ['preview' => ['cart_id', 'currency_code', 'subtotal_minor', 'delivery_fee_minor', 'total_minor', 'warnings']], 'meta' => ['correlation_id']]);

    // Nothing was reserved and nothing was written — a preview is a query.
    expect($cart->refresh()->status->value)->toBe('open')
        ->and(Order::query()->count())->toBe(0);
});

it('prices the basket alone when no address is named, honestly, never assuming free delivery', function (): void {
    $this->actingAs($this->shopper);

    $cart = previewableCart($this->world);

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $cart->getKey(),
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.subtotal_minor', 5000)
        ->assertJsonPath('data.preview.delivery_fee_minor', null)
        // Never the subtotal plus an assumed-free fee: the total omits a fee
        // that was never resolved rather than treating it as zero (OQ-045).
        ->assertJsonPath('data.preview.total_minor', 5000)
        ->assertJsonPath('data.preview.warnings', ['address_missing']);
});

it('reports an empty basket as a warning, not an error, and prices nothing', function (): void {
    $this->actingAs($this->shopper);

    $carts = app(CartService::class);
    $cart = $carts->getOrCreate($this->world->customer->account, $this->world->channel);

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.subtotal_minor', 0)
        ->assertJsonPath('data.preview.delivery_fee_minor', 500)
        ->assertJsonPath('data.preview.total_minor', 500)
        ->assertJsonPath('data.preview.line_count', 0)
        ->assertJsonPath('data.preview.warnings', ['cart_empty']);
});

it('names the same refusal language placement would use for an unserved area', function (): void {
    $this->actingAs($this->shopper);

    $cart = previewableCart($this->world);

    $strandedArea = CheckoutWorld::area('nowhere-'.substr(md5(__FUNCTION__), 0, 6));
    $stranded = CustomerAddress::query()->create([
        'customer_account_id' => $this->world->customer->account->getKey(),
        'address_type' => CustomerAddressType::Delivery,
        'delivery_area_id' => $strandedArea->getKey(),
        'label' => 'Nowhere',
        'line_one' => 'Unserved street 1',
        'is_default' => false,
        'lock_version' => 0,
    ]);

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $stranded->getKey(),
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.subtotal_minor', 5000)
        ->assertJsonPath('data.preview.delivery_fee_minor', null)
        ->assertJsonPath('data.preview.total_minor', 5000)
        ->assertJsonPath('data.preview.warnings', ['area_not_served']);
});

it('reports a suspended zone distinctly from an unserved one', function (): void {
    $this->actingAs($this->shopper);

    $cart = previewableCart($this->world);

    $zone = DeliveryZone::withoutTenancy()->whereKey($this->world->zone->getKey())->sole();
    $zone->status = 'inactive';
    $zone->save();

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.delivery_fee_minor', null)
        ->assertJsonPath('data.preview.warnings', ['zone_suspended']);
});

it('answers somebody else\'s cart or address with resource.not_found, exactly as placement does', function (): void {
    $this->actingAs($this->shopper);

    $stranger = CheckoutWorld::readyCustomer(DeliveryArea::query()->whereKey($this->world->area->getKey())->sole());
    $carts = app(CartService::class);
    $strangersCart = $carts->getOrCreate($stranger->account, $this->world->channel);

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $strangersCart->getKey(),
    ], firstPartyHeaders())
        ->assertStatus(404)
        ->assertJsonPath('error.code', 'resource.not_found');

    $cart = previewableCart($this->world);

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $stranger->address->getKey(),
    ], firstPartyHeaders())
        ->assertStatus(404)
        ->assertJsonPath('error.code', 'resource.not_found');
});
