<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * How a subscription plan may be bought — the source workbook's own PLN
 * vocabulary, kept verbatim.
 *
 * Deliberately not two booleans. "Sold both ways" is a third answer a kitchen
 * gives rather than the conjunction of the other two, and a pair of flags would
 * additionally let a plan say *neither*, which is not a state that means
 * anything.
 */
enum PlanType: string
{
    case Both = 'both';
    case Subscription = 'subscription';
    case LimitedTime = 'limited_time';
}
