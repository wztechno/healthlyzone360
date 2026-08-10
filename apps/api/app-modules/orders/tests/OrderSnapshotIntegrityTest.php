<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| An order is what was agreed, and it stays that way
|--------------------------------------------------------------------------
|
| The one smoke kept for order capture, because it is the property everything
| else in C1 exists to produce: what the customer committed to is frozen onto
| the order, the prices are the ones standing at placement rather than the ones
| the basket happened to see, the totals add up, and asking twice with one
| idempotency key produces one order.
|
| Comprehensive per-refusal coverage is deferred (speed mode); the reasons are
| enumerated in `PlacementRefused` and each is a single `if` in the service.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('snapshot@kitchen.test', unitPriceMinor: 2500, deliveryFeeMinor: 500);
    $this->carts = app(CartService::class);
    $this->placement = app(OrderPlacementService::class);
});

it('snapshots the commercial half of every line and reprices at placement', function (): void {
    $cart = $this->carts->getOrCreate($this->world->customer->account, $this->world->channel);
    $this->carts->addItem($cart, (string) $this->world->meal->getKey(), quantity: 2);

    // The tariff moves between filling the basket and paying for it: the
    // standing row is closed (`effective_to` is exclusive, so a row closed
    // today stops governing today) and a dearer one opens. The placement price
    // is the authoritative one — this is the whole reason no amount is stored
    // on a cart.
    PriceListItem::withoutTenancy()
        ->where('price_list_id', $this->world->priceList->getKey())
        ->update(['effective_to' => CarbonImmutable::now()->startOfDay()->toDateString()]);

    PricingWorld::price($this->world->priceList, $this->world->meal, null, 3100);

    $result = $this->placement->place($cart->refresh(), $this->world->customer->address);

    $order = $result->order;

    expect($result->replayed)->toBeFalse()
        ->and($order->status)->toBe(OrderStatus::Placed)
        ->and($order->payment_method)->toBe(PaymentMethod::CashOnDelivery)
        ->and($order->currency_code)->toBe('USD');

    $line = $order->lines()->sole();

    expect($line->unit_price_minor)->toBe(3100)
        ->and($line->line_total_minor)->toBe(6200)
        ->and($line->name_en)->toBe($this->world->meal->name_en)
        ->and($line->currency_code)->toBe('USD');

    // Totals are stored, and the database CHECK insists they agree.
    expect($order->subtotal_minor)->toBe(6200)
        ->and($order->delivery_fee_minor)->toBe(500)
        ->and($order->total_minor)->toBe(6700);

    // The delivery address is copied, not referenced.
    expect($order->delivery_line_one)->toBe('Rue Gouraud 12')
        ->and($order->delivery_area_name_en)->toBe('Achrafieh')
        ->and($order->delivery_zone_id)->toBe((string) $this->world->zone->getKey());

    // And the basket is closed in the same transaction, so the customer's open
    // slot on this channel is free and cannot be ordered twice.
    expect($cart->refresh()->status->value)->toBe('converted');
});

it('renaming the article afterwards does not rewrite the order', function (): void {
    $cart = $this->carts->getOrCreate($this->world->customer->account, $this->world->channel);
    $this->carts->addItem($cart, (string) $this->world->meal->getKey());

    $order = $this->placement->place($cart->refresh(), $this->world->customer->address)->order;

    $this->world->meal->name_en = 'Renamed after the fact';
    $this->world->meal->save();

    expect($order->lines()->sole()->name_en)->toBe('Chicken freekeh bowl');
});

it('refuses a day the branch has already closed ordering for', function (): void {
    // The one place C1 had to decide something K1.7 deliberately left open:
    // the cut-off on the requested day closes ordering for *that* day. Kept as
    // a smoke because the rule is a decision rather than a restatement, and
    // because it is the only exercise of the scheduling port.
    /*
     * Today at 16:00 in Beirut, not a date written into the source.
     *
     * An absolute day made this test depend on the wall clock: `CheckoutWorld`
     * builds its price `effective_from` today, so travelling to a fixed date
     * put the whole world in the future the moment real time passed it, and
     * the basket was refused `unpriced` long before the cut-off could be
     * reached. Anchoring on `now()` keeps the one relationship the test is
     * about — the clock is past the cut-off, the requested day is today — and
     * drops the one it never wanted.
     */
    $today = CarbonImmutable::now()->setTimezone('Asia/Beirut')->startOfDay();
    $this->travelTo($today->setTime(16, 0));

    CheckoutWorld::cutOff($this->world->branch, '15:00:00');

    $cart = $this->carts->getOrCreate(
        $this->world->customer->account,
        $this->world->channel,
        (string) $this->world->branch->getKey(),
    );

    $this->carts->addItem($cart, (string) $this->world->meal->getKey());

    try {
        $this->placement->place(
            $cart->refresh(),
            $this->world->customer->address,
            requestedDate: $today,
        );

        $this->fail('The placement should have been refused.');
    } catch (PlacementRefused $refusal) {
        /** @var list<array<string, mixed>> $reasons */
        $reasons = $refusal->details['reasons'];

        expect(array_column($reasons, 'reason'))->toContain('cut_off_passed')
            ->and($reasons[0]['cut_off_at'])->toBe('15:00:00');
    }

    // Tomorrow has not reached its cut-off, whatever the clock says now.
    $tomorrow = $today->addDay();

    $order = $this->placement->place(
        $cart->refresh(),
        $this->world->customer->address,
        requestedDate: $tomorrow,
    )->order;

    expect($order->requested_delivery_date->toDateString())->toBe($tomorrow->toDateString());
});

it('answers a repeated idempotency key with the original order rather than a second one', function (): void {
    $cart = $this->carts->getOrCreate($this->world->customer->account, $this->world->channel);
    $this->carts->addItem($cart, (string) $this->world->meal->getKey());

    $first = $this->placement->place($cart->refresh(), $this->world->customer->address, idempotencyKey: 'retry-me');

    // The client never saw the response and asks again with the same key. The
    // cart is converted by now, so without the key this would refuse — which
    // is exactly why the replay has to answer before any of that is reached.
    $second = $this->placement->place($cart->refresh(), $this->world->customer->address, idempotencyKey: 'retry-me');

    expect($second->replayed)->toBeTrue()
        ->and((string) $second->order->getKey())->toBe((string) $first->order->getKey())
        ->and(Order::query()->count())->toBe(1);
});
