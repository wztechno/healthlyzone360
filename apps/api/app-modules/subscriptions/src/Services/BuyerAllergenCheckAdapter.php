<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
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
     * One verdict per dish: the first of its lines that conflicts, since a sauce
     * chosen on one line and not another makes the same dish answer twice.
     *
     * @param  list<string>  $catalogueItemIds
     * @param  array<int, list<string>>  $optionIds
     * @return list<array{catalogue_item_id: string, reason: string, allergen_codes: list<string>}>
     */
    public function conflicts(CustomerAccount $account, array $catalogueItemIds, array $optionIds = []): array
    {
        $conflicts = [];

        foreach (array_values($catalogueItemIds) as $index => $itemId) {
            if (isset($conflicts[$itemId])) {
                continue;
            }

            $verdict = $this->safety->check($account, $itemId, $optionIds[$index] ?? []);

            if ($verdict['safe'] || $verdict['reason'] === null || $verdict['reason'] === 'item_unknown') {
                continue;
            }

            $conflicts[$itemId] = [
                'catalogue_item_id' => $itemId,
                'reason' => $verdict['reason'],
                'allergen_codes' => $verdict['allergen_classes'],
            ];
        }

        return array_values($conflicts);
    }

    /**
     * Read directly rather than through `DietaryProfileReader`, for the reason
     * `MealSafetyService` gives: this is the platform feeding the customer on
     * their own instruction. What staff later read of the copy is recorded by
     * `OrderPresenter`.
     *
     * @return list<array{allergen_code: string, severity: string, notes: string|null}>
     */
    public function declared(CustomerAccount $account): array
    {
        $profileId = CustomerDietaryProfile::query()
            ->where('customer_account_id', $account->getKey())
            ->value('id');

        if ($profileId === null) {
            return [];
        }

        return array_values(CustomerAllergenDeclaration::query()
            ->where('customer_dietary_profile_id', $profileId)
            ->orderBy('allergen_code')
            ->get()
            ->map(static fn (CustomerAllergenDeclaration $declaration): array => [
                'allergen_code' => $declaration->allergen_code,
                'severity' => $declaration->severity->value,
                'notes' => $declaration->notes,
            ])
            ->values()
            ->all());
    }
}
