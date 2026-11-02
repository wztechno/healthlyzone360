<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Orders\Services\NullHeldStockLookup;

/**
 * "Would selling this use stock that is on quality hold?"
 *
 * The desk quote asks it so the agent is warned while free stock of the same
 * ingredient is left (owner decision, 13 Oct 2026). A sale that could only come
 * out of held stock is refused, at every till, by
 * {@see \Healthy360\Cart\Contracts\QuarantinedStock} (owner, 2 Nov 2026).
 *
 * A port because the answer needs what a sale draws (Inventory's explosion) and
 * what is held (quality checks on receipts and batches), and order capture must
 * know neither vocabulary. {@see NullHeldStockLookup}
 * answers "nothing held" until Inventory binds the real one.
 */
interface HeldStockLookup
{
    /**
     * The names of the ingredients this many of `$item` would draw that have stock
     * on quality hold — a receipt line under a held check, or a batch that is.
     * Empty when nothing is held or the draw cannot be worked out.
     *
     * @return list<string>
     */
    public function heldFor(string $organisationId, ?string $branchId, CatalogueItem $item, string $quantity): array;
}
