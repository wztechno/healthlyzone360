<?php

declare(strict_types=1);

namespace Healthy360\Cart\Enums;

/**
 * What has become of a basket.
 *
 * Three states and two terminal ones. `Converted` and `Expired` both mean "no
 * longer shoppable", and they are kept apart because only one of them is a
 * success: a converted cart has an order behind it and is the record of what
 * that order was assembled from, while an expired one is somebody who
 * changed their mind. Collapsing them would make basket-abandonment
 * unanswerable.
 *
 * Deliberately **not** an operational `active | archived` pair. A cart is not
 * a configuration record; it is a moment in a customer's journey, and its
 * states are the shape of that journey.
 */
enum CartStatus: string
{
    case Open = 'open';
    case Converted = 'converted';
    case Expired = 'expired';

    /** Whether lines may still be added, changed or removed. */
    public function isShoppable(): bool
    {
        return $this === self::Open;
    }
}
