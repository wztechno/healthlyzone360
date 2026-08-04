<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Contracts;

use Carbon\CarbonImmutable;

/**
 * Finds the negotiated tariff a corporate buyer may be charged through a
 * seller's private channel.
 *
 * The pricing module asks this question; the B2B module answers it. The edge
 * runs B2B → Pricing in the registry, never the reverse, so the lookup is a
 * port rather than a model import.
 */
interface BuyerAgreementLookup
{
    /**
     * The buyer's agreement in force with this seller on the given day.
     *
     * @return array{
     *     agreement_id: string,
     *     price_list_id: string,
     *     minimum_order_minor: int|null,
     *     credit_limit_minor: int|null,
     *     currency_code: string|null,
     * }|null
     */
    public function activeAgreementFor(
        string $buyerOrganisationId,
        string $sellerOrganisationId,
        CarbonImmutable $on,
    ): ?array;
}
