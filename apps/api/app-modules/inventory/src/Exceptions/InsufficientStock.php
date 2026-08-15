<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A `consume` movement would drive a branch stock level below zero (INV1.0).
 *
 * The guard is on `consume` alone. `adjust` and `waste` are explicit human
 * corrections that may legitimately take a level negative — a stock count that
 * comes up short is a real negative, and refusing to record it would hide the
 * discrepancy rather than surface it. A consume is different: it is the system
 * asserting that stock left the shelf to make something, and asserting that
 * more left than was ever there is not a correction, it is a wrong number that
 * would then be valued as COGS. So it is refused, and the caller is told the
 * arithmetic — what was available and what was asked for — rather than a bare
 * "no".
 */
final class InsufficientStock extends ApiException
{
    /**
     * @param  numeric-string  $available
     * @param  numeric-string  $requested
     */
    public function __construct(string $branchId, string $stockItemId, string $available, string $requested)
    {
        parent::__construct(
            ErrorCode::InventoryInsufficientStock,
            'There is not enough stock to record this consumption.',
            [
                'branch_id' => $branchId,
                'stock_item_id' => $stockItemId,
                'available' => $available,
                'requested' => $requested,
            ],
        );
    }
}
