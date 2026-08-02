<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * What sort of route to market a sales channel is.
 *
 * The *kind* is a closed vocabulary a projection can branch on; the
 * *channel* is a row an organisation owns, because two kitchens legitimately
 * run two different wholesale desks with different availability and different
 * price lists. The frontend contract's `SalesChannel` union is the prototype's
 * flattening of the two, and the reconciliation is recorded in
 * `docs/api/conventions.md`.
 */
enum SalesChannelKind: string
{
    case B2cWeb = 'b2c_web';
    case B2b = 'b2b';
    case Pos = 'pos';
    case Marketplace = 'marketplace';
    case Corporate = 'corporate';
    case Insurance = 'insurance';

    /**
     * Whether prices quoted on this kind of channel are contract-private and
     * must never reach a consumer surface.
     *
     * No price exists in K1.4 — this is the vocabulary K1.5 and M1 will read,
     * declared with the kind it describes rather than invented later beside
     * the table that needs it.
     */
    public function hasPrivatePricing(): bool
    {
        return match ($this) {
            self::B2b, self::Corporate, self::Insurance => true,
            self::B2cWeb, self::Pos, self::Marketplace => false,
        };
    }
}
