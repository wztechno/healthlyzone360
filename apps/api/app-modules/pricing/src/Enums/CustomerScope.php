<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Enums;

/**
 * Who a tariff is for — the confidentiality boundary of the pricing module.
 *
 * A column rather than an inference from the channel kind, because one channel
 * legitimately carries both: a wholesale desk quotes its standing trade tariff
 * to anybody who asks and a negotiated sheet to one account, and deriving the
 * distinction from the channel would make the second inherit the first's
 * visibility.
 */
enum CustomerScope: string
{
    /**
     * The tariff anybody may be shown. Still not a licence to serve every row
     * inside it — placeholder and market-priced rows are excluded from the
     * public projection whatever list they sit on.
     */
    case PublicTariff = 'public';

    /**
     * One customer's negotiated position. Showing it to a second customer is
     * the commercial failure this module is built to prevent.
     */
    case Agreement = 'agreement';
}
