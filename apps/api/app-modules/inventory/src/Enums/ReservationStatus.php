<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Enums;

/**
 * What became of a claim on stock.
 *
 * Three values rather than a deleted row, because *why* a claim ended is a thing
 * a reader needs. `Consumed` means the batch took what it had claimed;
 * `Released` means it never did — the order was cancelled, or it finished using
 * less than it asked for. A production manager looking at a cancelled order has
 * to be able to see that the oil went back, rather than infer it from the
 * absence of a row.
 *
 * Only `Open` counts against availability. The other two are history.
 */
enum ReservationStatus: string
{
    case Open = 'open';
    case Released = 'released';
    case Consumed = 'consumed';
}
