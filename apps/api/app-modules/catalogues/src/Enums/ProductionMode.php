<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * Whether the kitchen makes this item, buys it in, or both — the source
 * technical sheets' `Kind` column.
 *
 * `Both` is not indecision: several source articles are produced in-house
 * when volume allows and bought in when it does not, and collapsing that into
 * one of the other two would lose the fact that the item has two supply paths
 * with different costs.
 */
enum ProductionMode: string
{
    case Production = 'production';
    case Supplier = 'supplier';
    case Both = 'both';
}
