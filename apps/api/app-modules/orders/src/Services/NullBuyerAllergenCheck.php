<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Contracts\BuyerAllergenCheck;

/**
 * The answer when no subscriptions module is installed, which is where the
 * allergen rule lives: no conflicts reported.
 *
 * Bound by `OrdersServiceProvider` and replaced by the subscriptions module's
 * adapter, so checkout keeps working — and keeps being testable — without it.
 */
final class NullBuyerAllergenCheck implements BuyerAllergenCheck
{
    /**
     * @param  list<string>  $catalogueItemIds
     * @return list<array{catalogue_item_id: string, reason: string, allergen_codes: list<string>}>
     */
    public function conflicts(CustomerAccount $account, array $catalogueItemIds): array
    {
        return [];
    }
}
