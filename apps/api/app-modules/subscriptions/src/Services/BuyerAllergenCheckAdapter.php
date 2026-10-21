<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Contracts\BuyerAllergenCheck;
use Healthy360\Subscriptions\Contracts\MealSafety;

/**
 * Checkout's allergen question, answered by the rule generation enforces.
 *
 * Bound over `NullBuyerAllergenCheck` from `SubscriptionsServiceProvider::boot()`
 * for the reason that provider gives about `SubscriptionOutlook`. It also serves
 * `GET /me/allergen-conflicts`, so a configurator's Review step and a basket's
 * checkout hear the same verdict for the same meal.
 *
 * `item_unknown` is not a conflict: a meal that no longer exists is the line
 * probe's refusal to report, not an allergy.
 */
final readonly class BuyerAllergenCheckAdapter implements BuyerAllergenCheck
{
    public function __construct(private MealSafety $safety) {}

    /**
     * @param  list<string>  $catalogueItemIds
     * @return list<array{catalogue_item_id: string, reason: string, allergen_codes: list<string>}>
     */
    public function conflicts(CustomerAccount $account, array $catalogueItemIds): array
    {
        $conflicts = [];

        foreach (array_values(array_unique($catalogueItemIds)) as $itemId) {
            $verdict = $this->safety->check($account, $itemId);

            if ($verdict['safe'] || $verdict['reason'] === null || $verdict['reason'] === 'item_unknown') {
                continue;
            }

            $conflicts[] = [
                'catalogue_item_id' => $itemId,
                'reason' => $verdict['reason'],
                'allergen_codes' => $verdict['allergen_classes'],
            ];
        }

        return $conflicts;
    }
}
