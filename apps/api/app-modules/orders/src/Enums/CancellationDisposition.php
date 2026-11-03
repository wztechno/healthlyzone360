<?php

declare(strict_types=1);

namespace Healthy360\Orders\Enums;

/**
 * What became of the food on an order cancelled after cooking started.
 *
 * `Returned` restores the stock, as every cancellation did before this existed.
 * `Wasted` leaves the deduction in place, so the cost stays counted: the
 * ingredients are gone whether or not anybody ate them. Valuing the waste is
 * Stage 3.
 *
 * An order cancelled before cooking starts has no answer to give, so the column
 * is null there and null restores.
 */
enum CancellationDisposition: string
{
    case Returned = 'returned';
    case Wasted = 'wasted';
}
