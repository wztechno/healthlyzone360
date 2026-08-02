<?php

declare(strict_types=1);

namespace Healthy360\Orders\Tests\Fixtures;

use Healthy360\Cart\Services\CartService;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderPlacementService;

/**
 * The orders suite's one builder: a placed order in a world `CheckoutWorld`
 * has already stood up.
 *
 * A fixture class rather than a Pest helper function, for the reason every
 * other module world gives: Pest loads the whole suite into one process, and
 * two files declaring `placeOne()` would be a fatal redeclaration rather than
 * a test failure.
 *
 * It builds **on** `CheckoutWorld` rather than duplicating it. Orders depends
 * on Cart, so a fixture in this direction is legal; a Cart fixture reaching
 * for `OrderPlacementService` would not be, which is why the placement helper
 * lives here and not there.
 */
final class OrderWorld
{
    /**
     * One line of the world's meal, placed against the world's address.
     */
    public static function place(object $world, int|float|string $quantity = 1): Order
    {
        $carts = app(CartService::class);

        $cart = $carts->getOrCreate($world->customer->account, $world->channel);
        $carts->addItem($cart, (string) $world->meal->getKey(), quantity: $quantity);

        return app(OrderPlacementService::class)->place($cart->refresh(), $world->customer->address)->order;
    }
}
