<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Customers\Models\CustomerFoodExclusion;
use Healthy360\Subscriptions\Contracts\MealSafety;

/**
 * The allergen gate, and the one rule in S1 that has no exceptions.
 *
 * **What makes a meal unsafe, in the order it is asked.**
 *
 * 1. **A declared allergen appears on the meal's label.** Any containment, any
 *    severity. `may_contain` is treated exactly as `contains`, and `avoidance`
 *    exactly as `anaphylaxis` — this class does not grade risk, because grading
 *    it would be a medical judgement the platform is not qualified to make and
 *    the customer already made theirs by declaring. §6 is written as an
 *    absolute and this is what implementing an absolute looks like: no
 *    threshold, no flag, no override.
 * 2. **An excluded ingredient is on the meal's list.** The `ingredient_id`
 *    form of `customer_food_exclusions` is, in that table's own words, "the
 *    strong form and the only one C1 can check mechanically". Both `dislike`
 *    and `forbidden` block, even though `FoodExclusionKind::isOverridable()`
 *    permits a dislike to be worked around: skipping a day is free (§6) and
 *    sending somebody a meal they told the kitchen they will not eat is not.
 *    Ranking a dislike below a skip rather than above it is the conservative
 *    reading, and it is recorded here as a decision rather than left to look
 *    like an oversight.
 * 3. **The meal has no allergen basis at all** and the customer has declared
 *    something. `DerivedAllergenService` returns `basis = none` for an item
 *    nobody has described, and that is "not assessed", not "no allergens" —
 *    the rule the recipe publication gate is built on. A customer with a nut
 *    allergy must not be sent a dish the platform knows nothing about.
 *
 * **What makes a meal safe** is the absence of all three, which for a customer
 * who has declared nothing is every meal.
 *
 * **The profile is read directly rather than through `DietaryProfileReader`.**
 * That class is the staff-side path: it demands a purpose of use and writes an
 * access event, because a human looking at somebody else's health data must
 * say why. Generation is not a human — it is the platform acting on the
 * customer's own instruction to feed them, closer to the self-service read
 * `DietaryProfileService` performs — and an access event per meal per day per
 * subscriber would bury the staff reads that the audit trail exists to surface.
 * What is recorded instead is the *outcome*: a `subscription.no_safe_meal` or
 * `subscription.meal_substituted` event carrying the classes that decided it,
 * once per delivery, on the subscription's own ledger.
 */
final readonly class MealSafetyService implements MealSafety
{
    public function __construct(private DerivedAllergenService $allergens) {}

    /**
     * @return array{safe: bool, allergen_classes: list<string>, reason: string|null}
     */
    public function check(CustomerAccount $account, string $catalogueItemId): array
    {
        $profile = $this->profileOf($account);

        $item = CatalogueItem::withoutTenancy()->whereKey($catalogueItemId)->first();

        if (! $item instanceof CatalogueItem) {
            return ['safe' => false, 'allergen_classes' => [], 'reason' => 'item_unknown'];
        }

        if (! $profile instanceof CustomerDietaryProfile) {
            // Nobody has told the platform anything. There is nothing to
            // violate, and refusing to feed a customer who never filled the
            // form in would be a worse answer than the empty one.
            return ['safe' => true, 'allergen_classes' => [], 'reason' => null];
        }

        $declared = $this->declaredClasses($profile);
        $derived = $this->allergens->forItem($item);

        /** @var list<string> $mealClasses */
        $mealClasses = array_values(array_unique(array_map(
            static fn (array $allergen): string => $allergen['allergen_code'],
            $derived['allergens'],
        )));

        $matched = array_values(array_intersect($declared, $mealClasses));

        if ($matched !== []) {
            return ['safe' => false, 'allergen_classes' => $matched, 'reason' => 'allergen_declared'];
        }

        if ($declared !== [] && $derived['basis'] === 'none') {
            // Not "no allergens" — "no basis". Silence is not a statement of
            // absence, and a declared allergy makes the difference matter.
            return ['safe' => false, 'allergen_classes' => [], 'reason' => 'unassessed'];
        }

        if ($this->excludedIngredientOn($profile, $item)) {
            return ['safe' => false, 'allergen_classes' => [], 'reason' => 'excluded'];
        }

        return ['safe' => true, 'allergen_classes' => [], 'reason' => null];
    }

    public function hasUnverifiableConstraints(CustomerAccount $account): bool
    {
        $profile = $this->profileOf($account);

        if (! $profile instanceof CustomerDietaryProfile) {
            return false;
        }

        return CustomerFoodExclusion::query()
            ->where('customer_dietary_profile_id', $profile->getKey())
            ->where(function ($query): void {
                $query->whereNotNull('diet_classification_id')->orWhereNotNull('free_text');
            })
            ->exists();
    }

    /**
     * The allergen classes this customer has declared.
     *
     * `declares_no_allergens` is not consulted as a shortcut, deliberately: a
     * profile that says "none" and also carries a declaration is a
     * contradiction, and reading the rows is the answer that cannot be wrong in
     * the dangerous direction.
     *
     * @return list<string>
     */
    private function declaredClasses(CustomerDietaryProfile $profile): array
    {
        return array_values(array_unique(CustomerAllergenDeclaration::query()
            ->where('customer_dietary_profile_id', $profile->getKey())
            ->pluck('allergen_code')
            ->map(static fn (mixed $code): string => (string) $code)
            ->all()));
    }

    private function excludedIngredientOn(CustomerDietaryProfile $profile, CatalogueItem $item): bool
    {
        /** @var list<string> $excluded */
        $excluded = CustomerFoodExclusion::query()
            ->where('customer_dietary_profile_id', $profile->getKey())
            ->whereNotNull('ingredient_id')
            ->pluck('ingredient_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        if ($excluded === []) {
            return false;
        }

        return array_intersect($excluded, $this->allergens->listedIngredientIds($item)) !== [];
    }

    private function profileOf(CustomerAccount $account): ?CustomerDietaryProfile
    {
        $profile = CustomerDietaryProfile::query()
            ->where('customer_account_id', $account->getKey())
            ->first();

        return $profile instanceof CustomerDietaryProfile ? $profile : null;
    }
}
