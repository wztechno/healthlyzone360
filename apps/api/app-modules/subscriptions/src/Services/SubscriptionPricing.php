<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\PlanDurationKind;
use Healthy360\Catalogues\Enums\PlanPricingBasis;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Services\ResolvedPrice;

/**
 * What a plan configuration costs per delivery day.
 *
 * **Asked twice in a subscription's life and never again.** Once at purchase,
 * where the answer is captured onto the row and becomes the grandfathered price
 * for the whole balance (§5); and once at renewal, where the customer is
 * quoted the *current* prices explicitly. Between those two moments nothing
 * re-resolves anything, which is the entire point — a live subscription is
 * insulated from the price list by construction rather than by everybody
 * remembering not to look.
 *
 * **The discount is applied here, once.** `plan_variant_durations` holds the
 * percentage a longer run takes off, and it is applied to the resolved list
 * price to produce the per-day number the customer pays. `NULL` survives the
 * whole journey and means "nobody stated one" — it is never coerced to zero, on
 * the way in or the way out, which is the rule `plan_variant_durations` states
 * in its own migration and which this class is the first consumer to have to
 * honour.
 *
 * **`pricing_basis` decides what the resolved number means**, and two of its
 * three values are answerable:
 *
 *  * `per_day` — the row *is* the per-day price. The workbook default.
 *  * `total` — the row is the whole run, so per-day is `total ÷ duration_days`.
 *    Exact division is not guaranteed; the remainder is absorbed into the
 *    stored per-day price by rounding half up, and the residue is at most one
 *    minor unit per day. It is *not* redistributed across days, because a
 *    subscription whose Tuesdays cost one fils more than its Wednesdays is a
 *    reconciliation nobody can perform.
 *  * `per_week` — **refused**, and deliberately. A subscription delivers on a
 *    chosen set of weekdays (§7), so a weekly price divided by seven charges a
 *    three-day-a-week customer for four days they never receive, and divided by
 *    the chosen weekday count it silently reprices when they change their
 *    weekdays. Neither is a number a kitchen quoted. It returns null with the
 *    `pricing_basis_unsupported` reason so the refusal names itself rather than
 *    looking like an unpriced plan.
 */
final readonly class SubscriptionPricing
{
    public function __construct(private PriceResolver $prices) {}

    /**
     * The current quote for one configuration on one run, or null with the
     * reasons it could not be quoted.
     *
     * @param  string  $salesChannelId  the channel being bought through
     * @param  string  $catalogueItemId  the plan
     * @param  string  $catalogueItemVariantId  the configuration — the matrix cell
     * @return array{0: PlanQuote|null, 1: list<array<string, mixed>>}
     */
    public function quote(
        string $salesChannelId,
        string $catalogueItemId,
        string $catalogueItemVariantId,
        string $planDurationId,
        ?CarbonImmutable $on = null,
    ): array {
        $reasons = [];

        $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($catalogueItemId)->first();

        if (! $profile instanceof SubscriptionPlanProfile) {
            return [null, [['reason' => 'plan_not_subscription', 'catalogue_item_id' => $catalogueItemId]]];
        }

        $duration = PlanDuration::withoutTenancy()->whereKey($planDurationId)->first();

        if (! $duration instanceof PlanDuration) {
            return [null, [['reason' => 'duration_unknown', 'plan_duration_id' => $planDurationId]]];
        }

        if ($duration->duration_kind !== PlanDurationKind::FixedDays || $duration->duration_days === null || $duration->duration_days < 1) {
            // A one-off has no balance of days to sell, and §1 makes a
            // subscription a balance. Refusing is the honest answer; the
            // one-off path is an ordinary order and C1 already owns it.
            return [null, [['reason' => 'duration_not_fixed', 'plan_duration_id' => $planDurationId]]];
        }

        $assignment = PlanVariantDuration::withoutTenancy()
            ->where('catalogue_item_variant_id', $catalogueItemVariantId)
            ->where('plan_duration_id', $planDurationId)
            ->first();

        if (! $assignment instanceof PlanVariantDuration) {
            $reasons[] = ['reason' => 'duration_not_offered', 'plan_duration_id' => $planDurationId];
        } elseif (! $assignment->is_available) {
            $reasons[] = ['reason' => 'duration_not_offered', 'plan_duration_id' => $planDurationId, 'withdrawn' => true];
        }

        if ($profile->pricing_basis === PlanPricingBasis::PerWeek) {
            $reasons[] = ['reason' => 'pricing_basis_unsupported', 'pricing_basis' => $profile->pricing_basis->value];
        }

        $price = $this->prices->currentFor(
            $salesChannelId,
            $catalogueItemId,
            $catalogueItemVariantId,
            1,
            $on,
        );

        if (! $price instanceof ResolvedPrice) {
            $reasons[] = ['reason' => 'unpriced', 'catalogue_item_id' => $catalogueItemId, 'catalogue_item_variant_id' => $catalogueItemVariantId];
        }

        if ($reasons !== [] || ! $price instanceof ResolvedPrice) {
            return [null, $reasons];
        }

        $days = $duration->duration_days;

        $listPerDay = $profile->pricing_basis === PlanPricingBasis::Total
            ? (int) round($price->amountMinor / $days)
            : $price->amountMinor;

        $discount = $assignment?->discount_percent;

        return [
            new PlanQuote(
                listPriceMinor: $listPerDay,
                discountPercent: $discount,
                perDayMinor: $this->afterDiscount($listPerDay, $discount),
                currencyCode: $price->currencyCode,
                days: $days,
                priceListId: $price->priceListId,
                priceListItemId: $price->priceListItemId,
            ),
            [],
        ];
    }

    /**
     * The per-day price after the duration discount.
     *
     * Rounded half up at the *per-day* number rather than at the run total,
     * because the per-day number is what a refund multiplies (§3) and what an
     * order line charges. Rounding the total and dividing back would produce a
     * per-day price that does not multiply up to the total the customer was
     * quoted, which is the arithmetic a customer checks first.
     *
     * A NULL discount takes nothing off. That is not the same statement as a
     * zero discount — see the class docblock — but it is the same arithmetic,
     * and the distinction is preserved by storing the NULL rather than by
     * pretending the subtraction differs.
     */
    public function afterDiscount(int $listMinor, ?string $discountPercent): int
    {
        if ($discountPercent === null) {
            return $listMinor;
        }

        $percent = (float) $discountPercent;

        if ($percent <= 0.0) {
            return $listMinor;
        }

        return (int) round($listMinor * (100.0 - $percent) / 100.0);
    }
}
