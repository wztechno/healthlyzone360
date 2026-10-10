<?php

declare(strict_types=1);

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A delivery may only name a window its zone offers
|--------------------------------------------------------------------------
|
| `ZoneWindowService::offeredCodes()` is the rule; placement refuses
| `window_not_offered`, the preview warns with the same word, and both the
| preview and the desk quote serve the offered set so a picker can filter.
| Pickup never asks. Subscription generation is exempt — see
| `subscriptions/tests/WindowOfferExemptionTest.php`.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('window-offer@kitchen.test');
    $this->shopper = User::query()->whereKey($this->world->customer->account->user_id)->sole();

    CheckoutWorld::window($this->world->zone, 'evening');
    CheckoutWorld::window($this->world->zone, 'morning', assigned: false);
});

function windowOfferCart(object $world): Cart
{
    $carts = app(CartService::class);

    $cart = $carts->getOrCreate($world->customer->account, $world->channel);
    $carts->addItem($cart, (string) $world->meal->getKey(), quantity: 2);

    return $cart->refresh();
}

it('refuses a delivery for a window the zone does not offer, and takes one it does', function (): void {
    $this->actingAs($this->shopper);

    $cart = windowOfferCart($this->world);
    $body = [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ];

    $this->postJson('/api/v1/orders', $body + ['delivery_window_code' => 'morning'], firstPartyHeaders())
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'order.placement_refused')
        ->assertJsonPath('error.details.reasons.0.reason', 'window_not_offered')
        ->assertJsonPath('error.details.reasons.0.delivery_window_code', 'morning')
        ->assertJsonPath('error.details.reasons.0.delivery_zone_id', (string) $this->world->zone->getKey());

    $this->postJson('/api/v1/orders', $body + ['delivery_window_code' => 'evening'], firstPartyHeaders())
        ->assertCreated();

    expect(Order::query()->sole()->delivery_window_code)->toBe('evening');
});

it('asks nothing of a pickup', function (): void {
    $result = app(OrderPlacementService::class)->placeComposed(new ComposedPlacement(
        account: $this->world->customer->account,
        address: null,
        organisationId: (string) $this->world->organisation->getKey(),
        salesChannelId: (string) $this->world->channel->getKey(),
        branchId: (string) $this->world->branch->getKey(),
        currencyCode: $this->world->organisation->default_currency_code,
        lines: [new ComposedLine(catalogueItemId: (string) $this->world->meal->getKey())],
        deliveryWindowCode: 'morning',
        requestedDate: CarbonImmutable::now()->addDays(3)->startOfDay(),
        fulfilmentType: FulfilmentType::Pickup,
    ));

    expect($result->order->delivery_window_code)->toBe('morning');
});

it('serves the offered set on the checkout preview and warns about the rest', function (): void {
    $this->actingAs($this->shopper);

    $cart = windowOfferCart($this->world);
    $body = [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ];

    $this->postJson('/api/v1/checkouts/preview', $body + ['delivery_window_code' => 'morning'], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.offered_window_codes', ['evening'])
        ->assertJsonPath('data.preview.warnings', ['window_not_offered']);

    $this->postJson('/api/v1/checkouts/preview', $body + ['delivery_window_code' => 'evening'], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.warnings', []);

    // No address, no zone, nothing to offer — null rather than an empty set.
    $this->postJson('/api/v1/checkouts/preview', ['cart_id' => (string) $cart->getKey()], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.offered_window_codes', null);
});

it('serves the offered set on a desk delivery quote and refuses the rest', function (): void {
    $this->actingAs(DeskWorld::agent($this->world, 'window-agent@desk.test'));

    $body = [
        'fulfilment_type' => 'delivery',
        'customer_account_id' => (string) $this->world->customer->account->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
        'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1]],
    ];

    $this->postJson('/api/v1/catalogue/order-desk/quote', $body, DeskWorld::headers($this->world))
        ->assertOk()
        ->assertJsonPath('data.quote.offered_window_codes', ['evening'])
        ->assertJsonPath('data.quote.quotable', true);

    $this->postJson('/api/v1/catalogue/order-desk/quote', $body + ['delivery_window_code' => 'morning'], DeskWorld::headers($this->world))
        ->assertOk()
        ->assertJsonPath('data.quote.refusals.0.reason', 'window_not_offered')
        ->assertJsonPath('data.quote.quotable', false);

    $this->postJson('/api/v1/catalogue/order-desk/quote', [
        'fulfilment_type' => 'counter',
        'lines' => $body['lines'],
    ], DeskWorld::headers($this->world))
        ->assertOk()
        ->assertJsonPath('data.quote.offered_window_codes', null);
});
