<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Contracts;

use Healthy360\Customers\Models\CustomerAccount;

/**
 * "Is it safe to send this person this meal?"
 *
 * A port because the answer is assembled from two modules this one has no
 * business learning the vocabulary of: the customer's declarations and
 * exclusions (Customers, special-category data behind a purpose-of-use reader)
 * and the meal's derived allergen label (Catalogues, which knows about frozen
 * recipe-version labels, containment strengths and derivation provenance).
 * Generation needs one boolean and a reason; acquiring both neighbours'
 * vocabularies to compute it would put the allergen rule in a third place.
 *
 * **The rule this port implements is absolute** (approved semantics §6):
 * automatic substitution never violates a customer's allergen declarations or
 * exclusions, and there is no override anywhere — no severity threshold below
 * which a match is tolerated, no "may contain" that is quietly allowed through,
 * no configuration flag. A `may_contain` label is treated exactly as a
 * `contains` one, because a warning the kitchen printed is a warning the
 * customer is entitled to act on, and a platform that decided on their behalf
 * that a trace was acceptable would be making a medical judgement it is not
 * qualified to make.
 *
 * The unsafe answer carries the classes that made it unsafe so the delivery
 * record can say *why* a day was skipped. The key is deliberately named
 * `allergen_classes` and not `allergen_codes`: the audit redactor blanks any
 * metadata key containing `code`, and a redacted allergen list is not a safety
 * record.
 */
interface MealSafety
{
    /**
     * Whether this meal may be sent to this customer, and what stops it.
     *
     * @param  string  $catalogueItemId  the meal being considered
     * @return array{safe: bool, allergen_classes: list<string>, reason: string|null}
     *                                                                                `reason` is `allergen_declared` when a declaration matches, `excluded`
     *                                                                                when a food exclusion does, `unassessed` when the meal has no allergen
     *                                                                                basis at all, and null when the meal is safe
     */
    public function check(CustomerAccount $account, string $catalogueItemId): array;

    /**
     * Whether this customer holds a constraint the platform cannot evaluate.
     *
     * Two of the three ways a customer may name something they will not eat are
     * deliberately unmatchable. Free text "is stored as written and never
     * matched against anything", because a system that string-matched "no nuts"
     * onto the allergen vocabulary would be inventing a medical fact — the
     * `customer_food_exclusions` migration says so in its own words. A diet
     * classification is unmatchable for a subtler reason: the customer's row
     * names what to *avoid* ("no pork") while `catalogue_item_diet_classifications`
     * names what an item *is*, and the polarity is not recoverable from the
     * data, so a machine reading either as the other could send exactly the
     * thing the customer excluded.
     *
     * The consequence is stated rather than hidden: a customer holding one of
     * these gets **no automatic substitution**. Their own choices are honoured
     * as made, and a slot that would need substituting is skipped without
     * consuming a day. Skipping is free (§6) and guessing is not.
     */
    public function hasUnverifiableConstraints(CustomerAccount $account): bool;
}
