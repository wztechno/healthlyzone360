<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

use Healthy360\Customers\Models\CustomerAccount;

/**
 * "Does this basket hold a meal this customer told us they cannot eat?"
 *
 * The question checkout asks before a one-off order is placed, answered by the
 * **same rule** subscription generation already enforces — `MealSafety` in the
 * subscriptions module. One rule in one place: an order and a subscription
 * that disagreed about whether Aioli is safe for somebody with an egg allergy
 * would be worse than either having no check.
 *
 * A port rather than a call because the registry edge runs Subscriptions →
 * Orders (`SubscriptionOutlook` gives the full argument). Orders binds
 * `NullBuyerAllergenCheck` so a deployment without subscriptions still places
 * orders; the subscriptions module binds the real adapter over it from `boot()`.
 *
 * Unlike generation, checkout does not refuse outright. The customer chose the
 * meal themselves, so placement refuses `allergen_conflict` until the request
 * says the conflict was seen (`acknowledge_allergen_conflicts`) — the same
 * shape as the virtual dietitian's acknowledgement gate.
 */
interface BuyerAllergenCheck
{
    /**
     * The meals among these that conflict with the customer's declarations,
     * one entry per meal, in the order given. Safe meals are left out.
     *
     * `reason` is `allergen_declared`, `excluded` or `unassessed`, exactly as
     * `MealSafety::check()` names them; `allergen_codes` is filled only for
     * `allergen_declared`.
     *
     * `$optionIds` is the dish options chosen on each line, by the same index as
     * `$catalogueItemIds`: a sauce or side choice brings its recipe's allergens
     * with it. A dish asked twice with different choices answers once, for the
     * first line that conflicts.
     *
     * @param  list<string>  $catalogueItemIds
     * @param  array<int, list<string>>  $optionIds
     * @return list<array{catalogue_item_id: string, reason: string, allergen_codes: list<string>}>
     */
    public function conflicts(CustomerAccount $account, array $catalogueItemIds, array $optionIds = []): array;

    /**
     * Every allergy this customer has declared, conflicting with anything or not.
     *
     * What an order snapshots: the cook should know about a severe allergy even
     * when the check found no match. `notes` is the customer's own wording,
     * served to the kitchen because the audit's failing case was a note saying
     * exactly how dangerous a dish would be.
     *
     * @return list<array{allergen_code: string, severity: string, notes: string|null}>
     */
    public function declared(CustomerAccount $account): array;
}
