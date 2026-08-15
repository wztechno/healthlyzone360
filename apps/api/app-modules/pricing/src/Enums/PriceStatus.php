<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Enums;

/**
 * What a price row actually claims — the honest badge (user-confirmed decision
 * OD-2, risk R9).
 *
 * The database enforces the half of this that matters as a CHECK:
 * `(price_status = 'confirmed') = (unit_amount_minor IS NOT NULL)`. A
 * confirmed row without a number and a placeholder carrying one are both
 * refused, so no import, backfill or future writer can produce a price that
 * looks real and is not.
 */
enum PriceStatus: string
{
    /**
     * A real number the kitchen stands behind. The only status a public
     * surface may serve.
     */
    case Confirmed = 'confirmed';

    /**
     * The source stated no price and nobody has supplied one. **Never public.**
     * A placeholder rendered as a price is a lie with a currency symbol on it;
     * rendered as zero it is a worse one.
     */
    case Placeholder = 'placeholder';

    /**
     * The article is quoted at the time of sale — the appendix D
     * "market-priced → NULL-amount row" finding. The absence of a number *is*
     * the statement, which is why it is a status rather than a missing row.
     */
    case MarketPriced = 'market_priced';

    /**
     * Whether a row in this state carries an amount. The DB CHECK is the
     * authority; this is the same fact where PHP can read it.
     */
    public function carriesAmount(): bool
    {
        return $this === self::Confirmed;
    }
}
