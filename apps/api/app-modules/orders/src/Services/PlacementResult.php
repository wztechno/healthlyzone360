<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Orders\Models\Order;

/**
 * What `OrderPlacementService::place()` gives back.
 *
 * `replayed` is the load-bearing field. An idempotent replay and a fresh
 * placement both hand back an order, and the HTTP layer has to tell them
 * apart: the first is `200` with the original order, the second is `201` with
 * a new one. Returning a bare `Order` would make that distinction unavailable
 * to the only caller that needs it, and every client would see `201` for an
 * order it had already been told about.
 */
final readonly class PlacementResult
{
    public function __construct(
        public Order $order,
        public bool $replayed = false,
    ) {}
}
