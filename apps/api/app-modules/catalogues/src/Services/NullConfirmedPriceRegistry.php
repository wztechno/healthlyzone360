<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Contracts\ConfirmedPriceRegistry;

/**
 * The answer when no module prices anything: **nothing is priced**.
 *
 * Fail-closed, and that direction matters. The optimistic null object — "assume
 * everything is priced" — would make a plan publishable the moment the pricing
 * module were absent or its binding broken, which is precisely the failure the
 * price gate exists to prevent, and it would fail silently. An over-strict
 * default announces itself on the first publish attempt; an over-permissive one
 * announces itself when a customer is quoted a plan nobody priced.
 */
final class NullConfirmedPriceRegistry implements ConfirmedPriceRegistry
{
    /**
     * @param  list<string>  $variantIds
     * @return list<string>
     */
    public function pricedVariantIds(string $organisationId, array $variantIds): array
    {
        return [];
    }
}
