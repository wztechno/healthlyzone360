<?php

declare(strict_types=1);

namespace Healthy360\Cart\Contracts;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Orders\Contracts\HeldStockLookup;

/**
 * "Could this sale only be made from stock on quality hold?"
 *
 * A port because the answer needs what a sale draws and what is set aside, and
 * Inventory sits downstream of the basket. Inventory binds it. An ingredient on
 * hold with free stock beside it is not refused: that is the desk's warning
 * ({@see HeldStockLookup}).
 */
interface QuarantinedStock
{
    public function refuses(string $organisationId, CatalogueItem $item, string $quantity): bool;
}
