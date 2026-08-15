<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Two properties an order schema must have, asserted rather than remembered
|--------------------------------------------------------------------------
|
| Both of these are the kind of rule that survives as a convention for exactly
| as long as the person who wrote it is in the room.
|
| **No cost anywhere on an order.** What an order cost the kitchen to make is a
| different question, asked of `recipe_cost_snapshots` behind
| `recipe.view_costs_organisation`. An order is what the customer was charged.
| An order line is also the row most likely to be handed to a customer, a
| courier or a marketplace partner, so a cost column here would be a §4.8
| disclosure waiting for somebody to write a projection.
|
| **No payment column of any kind.** Cash on delivery is the whole of C1
| (F-bis #3), and a nullable card token would be an invitation: something
| eventually writes to it, and the first thing to write a card reference into a
| schema with no PCI scope has created a liability no later migration removes.
|
| **One currency per order**, proved by the service refusing rather than by a
| column comment.
|
*/

it('carries no cost, margin or supplier column on either order table', function (): void {
    $suspects = ['cost', 'margin', 'markup', 'supplier', 'waste', 'yield', 'wholesale', 'landed'];

    foreach (['orders', 'order_lines'] as $table) {
        /** @var list<string> $columns */
        $columns = DB::table('information_schema.columns')
            ->where('table_schema', 'public')
            ->where('table_name', $table)
            ->pluck('column_name')
            ->all();

        foreach ($columns as $column) {
            foreach ($suspects as $suspect) {
                $this->assertStringNotContainsString(
                    $suspect,
                    strtolower($column),
                    "{$table}.{$column} looks like a cost column. An order records what the customer was charged, never what the food cost the kitchen (plan §4.8).",
                );
            }
        }
    }
});

it('carries no card, token or payment-provider column, and admits exactly one payment method', function (): void {
    /** @var list<string> $columns */
    $columns = DB::table('information_schema.columns')
        ->where('table_schema', 'public')
        ->where('table_name', 'orders')
        ->pluck('column_name')
        ->all();

    foreach (['card', 'token', 'pan', 'cvv', 'provider', 'gateway', 'authorization', 'authorisation'] as $suspect) {
        foreach ($columns as $column) {
            $this->assertStringNotContainsString(
                $suspect,
                strtolower($column),
                "orders.{$column} looks like a payment column. C1 takes cash at the door and models nothing else (F-bis #3); payments arrive with PAY1, under their own review.",
            );
        }
    }

    // And the single-value CHECK exists, so widening it has to be a migration
    // somebody writes on purpose rather than a value somebody inserts.
    expect(DB::table('pg_constraint')->where('conname', 'orders_payment_method_check')->exists())->toBeTrue()
        ->and(PaymentMethod::cases())->toHaveCount(1)
        ->and(PaymentMethod::cases()[0])->toBe(PaymentMethod::CashOnDelivery);
});

describe('one currency per order', function (): void {
    beforeEach(function (): void {
        $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

        $this->world = CheckoutWorld::build('arch-currency@kitchen.test');
        $this->carts = app(CartService::class);
    });

    it('refuses to place an order whose repriced line has changed currency', function (): void {
        $cart = $this->carts->getOrCreate($this->world->customer->account, $this->world->channel);
        $this->carts->addItem($cart, (string) $this->world->meal->getKey());

        // Between filling the basket and paying for it the kitchen withdraws
        // the dollar tariff and prices the same article in euro. Placement
        // reprices, finds a currency the order is not denominated in, and
        // refuses the whole order rather than converting or mixing.
        PriceListItem::withoutTenancy()
            ->where('price_list_id', $this->world->priceList->getKey())
            ->update(['effective_to' => now()->startOfDay()->toDateString()]);

        $euroList = CheckoutWorld::foreignPriceList($this->world->organisation, $this->world->channel, 'EUR', priority: 10);
        PricingWorld::price($euroList, $this->world->meal, null, 1900);

        $place = fn () => app(OrderPlacementService::class)->place($cart->refresh(), $this->world->customer->address);

        expect($place)->toThrow(PlacementRefused::class);

        // The basket survives the refusal, so the customer can fix it rather
        // than rebuild it, and no half-order exists.
        expect($cart->refresh()->status->value)->toBe('open')
            ->and(Order::query()->count())->toBe(0);
    });
});
