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
    /** The scale the inventory layer compares quantities at. */
    private const int SCALE = 6;

    /**
     * @param  numeric-string  $available  on-hand minus every claim this caller does not already hold
     * @param  numeric-string  $requested
     * @param  numeric-string|null  $reserved  how much of the shelf other holders have claimed, reported separately so an empty shelf and a spoken-for one do not read alike (PROD1)
     */
    public function __construct(
        string $branchId,
        string $stockItemId,
        string $available,
        string $requested,
        ?string $reserved = null,
    ) {
        parent::__construct(
            ErrorCode::InventoryInsufficientStock,
            'There is not enough stock to record this consumption.',
            [
                'branch_id' => $branchId,
                'stock_item_id' => $stockItemId,
                'available' => $available,
                'requested' => $requested,
                'reserved' => $reserved ?? '0',
            ],
        );
    }

    /**
     * Whether a reservation, rather than an empty shelf, is what blocked this.
     *
     * The caller that needs this is the customer-order path: a sale blocked by a
     * production claim is recorded as `reserved_for_production` rather than
     * `insufficient_stock`, because the two have different answers — buy more, or
     * talk to the kitchen about the batch.
     *
     * **A claim on the shelf is not enough to earn that answer.** The test is
     * whether the shelf would have covered the consume without the claim: on-hand
     * is `available + reserved`, so a request that exceeds even that was short on
     * its own and stays `insufficient_stock`. A shelf holding 1 with 5 claimed
     * against a request for 10 has two problems, and only one of them is the
     * batch's fault.
     */
    public function isBlockedByReservation(): bool
    {
        $reserved = $this->details['reserved'] ?? '0';
        $available = $this->details['available'] ?? '0';
        $requested = $this->details['requested'] ?? '0';

        // `details` is `array<string, mixed>`, so each figure is narrowed to a
        // numeric string before any bcmath touches it — a non-numeric string
        // handed to bccomp reads as zero, which would answer this question with
        // a confident wrong "no".
        if (! is_string($reserved) || ! is_numeric($reserved)) {
            return false;
        }

        if (! is_string($available) || ! is_numeric($available)) {
            return false;
        }

        if (! is_string($requested) || ! is_numeric($requested)) {
            return false;
        }

        if (bccomp($reserved, '0', self::SCALE) <= 0) {
            return false;
        }

        return bccomp(bcadd($available, $reserved, self::SCALE), $requested, self::SCALE) >= 0;
    }
}
