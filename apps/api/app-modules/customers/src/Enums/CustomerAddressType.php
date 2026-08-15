<?php

declare(strict_types=1);

namespace Healthy360\Customers\Enums;

/**
 * What an address is for.
 *
 * Two values because they behave differently in one way that matters: a
 * delivery address must sit in an area some kitchen serves, and a billing
 * address must not be checked against delivery geography at all. A single
 * address kind would force one rule onto both.
 */
enum CustomerAddressType: string
{
    case Delivery = 'delivery';

    case Billing = 'billing';

    /**
     * Whether an address of this kind has to be in a served area.
     */
    public function requiresService(): bool
    {
        return $this === self::Delivery;
    }
}
