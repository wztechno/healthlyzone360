<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\B2b\Tests\Fixtures\B2bCheckoutWorld;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Services\ResolvedPrice;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

it('prices each corporate buyer through their own agreement on a wholesale channel', function (): void {
    $world = B2bCheckoutWorld::dualAgreement();
    $resolver = app(PriceResolver::class);

    $acmePrice = $resolver->currentFor(
        (string) $world['channel']->getKey(),
        (string) $world['meal']->getKey(),
        buyer: $world['buyers']['acme']['account'],
    );

    $betaPrice = $resolver->currentFor(
        (string) $world['channel']->getKey(),
        (string) $world['meal']->getKey(),
        buyer: $world['buyers']['beta']['account'],
    );

    expect($acmePrice)->toBeInstanceOf(ResolvedPrice::class)
        ->and($acmePrice->amountMinor)->toBe(1800)
        ->and($acmePrice->priceListId)->toBe((string) $world['buyers']['acme']['agreementList']->getKey())
        ->and($betaPrice)->toBeInstanceOf(ResolvedPrice::class)
        ->and($betaPrice->amountMinor)->toBe(2200)
        ->and($betaPrice->priceListId)->toBe((string) $world['buyers']['beta']['agreementList']->getKey());
});

it('leaves the consumer web shop resolver unchanged', function (): void {
    $consumer = CheckoutWorld::build('b2c-unchanged@kitchen.test', unitPriceMinor: 2500);
    $resolver = app(PriceResolver::class);

    $price = $resolver->currentFor(
        (string) $consumer->channel->getKey(),
        (string) $consumer->meal->getKey(),
    );

    expect($price)->toBeInstanceOf(ResolvedPrice::class)
        ->and($price->amountMinor)->toBe(2500)
        ->and($price->priceListId)->toBe((string) $consumer->priceList->getKey());
});

it('never exposes another buyers agreement tariff without that buyer', function (): void {
    $world = B2bCheckoutWorld::dualAgreement();

    $withoutBuyer = app(PriceResolver::class)->currentFor(
        (string) $world['channel']->getKey(),
        (string) $world['meal']->getKey(),
    );

    expect($withoutBuyer)->toBeInstanceOf(ResolvedPrice::class)
        ->and($withoutBuyer->amountMinor)->toBe(3000)
        ->and($withoutBuyer->priceListId)->toBe((string) $world['publicList']->getKey());
});

it('refuses a consumer account opening a cart on a wholesale channel', function (): void {
    $world = B2bCheckoutWorld::dualAgreement();
    $consumer = CheckoutWorld::build('consumer-blocked@kitchen.test');
    $shopper = User::query()->whereKey($consumer->customer->account->user_id)->sole();

    $this->actingAs($shopper)
        ->postJson('/api/v1/carts', ['channel_code' => $world['channel']->code], firstPartyHeaders())
        ->assertForbidden()
        ->assertJsonPath('error.code', 'cart.channel_refused');
});

it('places a wholesale order priced from the buyers agreement', function (): void {
    $world = B2bCheckoutWorld::dualAgreement();
    $buyer = $world['buyers']['acme'];
    $carts = app(CartService::class);

    $this->actingAs($buyer['user']);

    $cartResponse = $this->postJson('/api/v1/carts', [
        'channel_code' => $world['channel']->code,
    ], $buyer['headers'])->assertOk();

    $cartId = $cartResponse->json('data.cart.id');

    $this->postJson('/api/v1/carts/'.$cartId.'/items', [
        'catalogue_item_id' => (string) $world['meal']->getKey(),
        'quantity' => 2,
    ], $buyer['headers'])->assertCreated();

    $cart = $carts->openCartFor($buyer['account'], $world['channel']);
    $result = app(OrderPlacementService::class)->place($cart, $buyer['address']);
    $order = $result->order;

    expect($order->subtotal_minor)->toBe(3600)
        ->and($order->b2b_agreement_id)->toBe((string) $buyer['agreement']->getKey())
        ->and($order->price_list_id)->toBe((string) $buyer['agreementList']->getKey())
        ->and($order->lines->first()?->unit_price_minor)->toBe(1800);
});

it('lists catalogue items for a corporate buyer with agreement prices', function (): void {
    $world = B2bCheckoutWorld::dualAgreement();
    $buyer = $world['buyers']['acme'];

    $this->actingAs($buyer['user'])
        ->getJson('/api/v1/b2b/catalogue/items', $buyer['headers'])
        ->assertOk()
        ->assertJsonPath('data.items.0.id', (string) $world['meal']->getKey())
        ->assertJsonPath('data.items.0.price.amount_minor', 1800)
        ->assertJsonMissing(['price_list_id', 'price_list_item_id', 'unit_amount_minor']);
});

it('refuses placement below the agreement minimum order', function (): void {
    $world = B2bCheckoutWorld::dualAgreement();
    $buyer = $world['buyers']['acme'];

    $buyer['agreement']->minimum_order_minor = 10000;
    $buyer['agreement']->save();

    $carts = app(CartService::class);
    $cart = $carts->getOrCreate($buyer['account'], $world['channel']);
    $carts->addItem($cart, (string) $world['meal']->getKey(), quantity: 1);

    app(OrderPlacementService::class)->place($cart->refresh(), $buyer['address']);
})->throws(PlacementRefused::class);
