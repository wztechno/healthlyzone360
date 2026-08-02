<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Exceptions\LineRefused;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Two currencies never become one number
|--------------------------------------------------------------------------
|
| The plan's rule that every amount carries its currency (§4.4) is only real if
| something refuses when two of them meet. There is no conversion anywhere in
| Cart or Orders — converting would mean inventing an exchange rate, storing a
| number nobody quoted, and producing a total that reconciles against nothing —
| so the only correct behaviour is a visible refusal.
|
| This is the basket half. The placement half — an order whose repriced line
| has changed currency — lives in the orders suite, so that a Cart test never
| reaches for an Orders class and inverts the dependency the registry states.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('currency@kitchen.test');
    $this->carts = app(CartService::class);
});

it('refuses a line the channel only prices in another currency', function (): void {
    $cart = $this->carts->getOrCreate($this->world->customer->account, $this->world->channel);

    expect($cart->currency_code)->toBe('USD');

    // A second article this channel prices only from a euro tariff. The
    // channel is legitimately configured — a kitchen may hold two lists — and
    // the basket is denominated in the higher-priority one.
    $euroList = CheckoutWorld::foreignPriceList($this->world->organisation, $this->world->channel, 'EUR');
    $euroOnly = CheckoutWorld::publishedMeal($this->world->tenant, 'Priced in euro');
    CheckoutWorld::offer($this->world->channel, $euroOnly);
    PricingWorld::price($euroList, $euroOnly, null, 1900);

    $add = fn () => $this->carts->addItem($cart, (string) $euroOnly->getKey());

    expect($add)->toThrow(LineRefused::class);

    try {
        $add();
    } catch (LineRefused $refusal) {
        /** @var list<array<string, mixed>> $reasons */
        $reasons = $refusal->details['reasons'];

        expect(array_column($reasons, 'reason'))->toContain('currency_mismatch')
            ->and($reasons[0]['expected_currency'])->toBe('USD')
            ->and($reasons[0]['offered_currency'])->toBe('EUR');
    }

    // And nothing was written: a refused line is not a line.
    expect($cart->items()->count())->toBe(0);
});
