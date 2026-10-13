<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Orders\Contracts\HeldStockLookup;

/**
 * Nothing is held until Inventory answers the question for real.
 */
final class NullHeldStockLookup implements HeldStockLookup
{
    public function heldFor(string $organisationId, ?string $branchId, CatalogueItem $item, string $quantity): array
    {
        return [];
    }
}
