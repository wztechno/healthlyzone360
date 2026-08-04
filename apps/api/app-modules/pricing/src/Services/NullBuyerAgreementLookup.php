<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

use Carbon\CarbonImmutable;
use Healthy360\Pricing\Contracts\BuyerAgreementLookup;

/**
 * The default when no B2B module is bound — every buyer prices as today.
 */
final readonly class NullBuyerAgreementLookup implements BuyerAgreementLookup
{
    public function activeAgreementFor(
        string $buyerOrganisationId,
        string $sellerOrganisationId,
        CarbonImmutable $on,
    ): ?array {
        return null;
    }
}
