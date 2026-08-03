<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

/**
 * One line of an order the platform composed rather than a customer filled.
 *
 * The `cart_items` row's equivalent for a placement that has no basket behind
 * it. `quantity` is a decimal string for the same reason the column is: a
 * quantity that round-trips through a float acquires a fifteenth decimal place
 * and a line total nobody can reproduce.
 *
 * `price` is optional and the default is the C1 rule: repriced at placement by
 * the resolver, exactly as a basket line is. Supplying one is a deliberate act
 * documented on `PriceOverride`.
 */
final readonly class ComposedLine
{
    public function __construct(
        public string $catalogueItemId,
        public ?string $catalogueItemVariantId = null,
        public string $quantity = '1',
        public ?PriceOverride $price = null,
    ) {}
}
