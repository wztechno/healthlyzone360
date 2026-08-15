<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Subscriptions\Contracts\MealSafety;
use Healthy360\Subscriptions\Models\Subscription;

/**
 * A meal to send instead, or nothing.
 *
 * **The search is narrow on purpose.** §6 allows automatic substitution "only
 * within the same plan, same meal type, same calorie band, and never violating
 * the customer's allergen declarations or exclusions". Three of those four are
 * implemented as written; the fourth is implemented as far as the data allows,
 * and the gap is stated rather than papered over:
 *
 *  * **Same plan** — the candidate must be a `meal` in the same organisation
 *    and offered on the same sales channel on the delivery date, which is what
 *    "reachable through this plan" means in K1's model. There is no menu table
 *    linking plans to dishes yet, so a tighter reading is not expressible.
 *  * **Same meal type** — the candidate must share the replaced meal's
 *    `product_category_id`. That column is the closest thing the catalogue has
 *    to a meal type; a meal carries no breakfast/lunch/dinner attribute of its
 *    own. A meal with no category at all matches only other meals with none,
 *    rather than matching everything, because "uncategorised" is not a
 *    category two dishes have in common.
 *  * **Same calorie band** — **not enforceable today, and this is the honest
 *    statement of it.** `energy_bands` hangs off `plan_variant_profiles`, which
 *    is a property of the plan *configuration*, not of a meal; no meal carries
 *    a band. Every candidate here belongs to the same plan configuration and
 *    therefore to the same band by construction, which satisfies the rule
 *    vacuously rather than by checking it. The day a meal carries its own band,
 *    this is where the predicate goes. Recorded as a deferred item.
 *  * **Allergen safety** — absolute, delegated to `MealSafety`, checked on
 *    every candidate before it is offered and never bypassed.
 *
 * **A customer with an unverifiable constraint gets no substitution at all.**
 * A free-text exclusion is never matched against anything, and a diet
 * classification cannot be read for polarity — see `MealSafety`. Substituting
 * for such a customer would mean the platform choosing a dish while unable to
 * evaluate one of the things they said they will not eat. Skipping the day
 * costs the customer nothing (§6); guessing could cost them a great deal.
 *
 * **Ordering is deterministic.** Candidates are ranked by name so that two runs
 * of the same generation choose the same dish. A random or insertion-ordered
 * pick would make an allergy complaint unreproducible, which is exactly the
 * complaint that most needs reproducing.
 */
final readonly class SubstitutionFinder
{
    public function __construct(
        private MealSafety $safety,
        private LineProbe $probe,
    ) {}

    /**
     * A safe, orderable meal to send in place of `$replacing`, or null.
     *
     * @param  CatalogueItem  $replacing  the meal that cannot be sent
     * @return array{0: CatalogueItem|null, 1: string|null} the substitute and, when there is none, why not
     */
    public function forSubscription(
        Subscription $subscription,
        CatalogueItem $replacing,
        CarbonImmutable $on,
    ): array {
        if ($subscription->no_substitutions) {
            // The per-subscription opt-out (§6): "no substitutions — skip
            // instead". Asked before anything else, so a customer who chose it
            // never has candidates evaluated on their behalf.
            return [null, 'no_substitutions_opted_out'];
        }

        $account = $subscription->customerAccount;

        if ($account === null) {
            return [null, 'account_unknown'];
        }

        if ($this->safety->hasUnverifiableConstraints($account)) {
            return [null, 'unverifiable_exclusion'];
        }

        $channel = SalesChannel::withoutTenancy()->whereKey($subscription->sales_channel_id)->first();

        if (! $channel instanceof SalesChannel) {
            return [null, 'channel_unknown'];
        }

        $candidates = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $subscription->organisation_id)
            ->where('item_type', CatalogueItemType::Meal->value)
            ->where('status', CatalogueItemStatus::Published->value)
            ->whereKeyNot($replacing->getKey())
            ->when(
                $replacing->product_category_id === null,
                fn ($query) => $query->whereNull('product_category_id'),
                fn ($query) => $query->where('product_category_id', $replacing->product_category_id),
            )
            ->orderBy('name_en')
            ->orderBy('id')
            ->get();

        foreach ($candidates as $candidate) {
            $verdict = $this->safety->check($account, (string) $candidate->getKey());

            if (! $verdict['safe']) {
                continue;
            }

            // Orderable as well as safe. A dish the channel does not offer on
            // the day is not a substitute, it is a second failure — and the
            // probe is the single definition of "orderable" the whole platform
            // uses, so asking it here cannot disagree with placement.
            $probe = $this->probe->probe(
                $channel,
                (string) $candidate->getKey(),
                null,
                '1',
                $on,
                $subscription->currency_code,
            );

            if ($probe->isOrderable()) {
                return [$candidate, null];
            }
        }

        return [null, 'no_safe_candidate'];
    }
}
