<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * Whether a sales channel is currently trading.
 *
 * Operational, never the sellable family: nothing a customer sees is a
 * channel. What a customer sees is the items available *through* one.
 */
enum SalesChannelStatus: string
{
    case Active = 'active';
    case Inactive = 'inactive';
}
