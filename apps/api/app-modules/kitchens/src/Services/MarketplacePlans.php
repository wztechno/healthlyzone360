<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\PlanDurationKind;
use Healthy360\Catalogues\Enums\PlanPricingBasis;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Services\ResolvedPrice;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Eloquent\Builder;

/**
 * The published subscription plans a customer can see.
 *
 * ## Why this endpoint is expected to be empty
 *
 * It is, today, and that is the correct answer rather than a gap. The real
 * Healthy360 workbook kitchen imported in K1.8 is entirely draft by design, and the
 * demonstration kitchen's one plan is deliberately left unpublishable — its
 * premium configuration carries no confirmed price, which is exactly the state
 * the K1.6 publish gate exists to refuse. An endpoint that returned those plans
 * anyway would be selling something nobody has agreed to sell. The frontend
 * plan pages therefore stay mock-backed after M1 (the plan's own
 * "plans conditional" rule), and this endpoint is here so that the day a
 * kitchen finishes a plan, the plan appears without another phase.
 *
 * ## What makes a plan public
 *
 * Publication and an active kitchen, and nothing else. Unlike a meal, a plan is
 * **not** additionally gated on a channel availability row: the plan publish
 * gate is already the stronger statement — terms written, a matrix of active
 * configurations, a duration a customer could buy, and a confirmed standing
 * price on *every* active configuration — and adding a weaker second gate that
 * the publish path never asks for would make a plan its kitchen had fully
 * prepared invisible for a reason nobody was told about.
 *
 * ## Money
 *
 * `price_per_week` is the consumer contract's unit, and the platform stores a
 * plan's price on the basis the plan itself declares (`per_day`, `per_week` or
 * `total`). The conversion is stated once, here:
 *
 * - `per_week` → the amount, unchanged.
 * - `per_day` → the amount × 7. Multiplying a real confirmed daily price by
 *   seven is arithmetic, not invention.
 * - `total` → **no weekly figure exists.** A total is a price for a run whose
 *   length is a different column, and dividing it by a duration to manufacture
 *   a weekly rate would publish a number no kitchen quoted. Such a
 *   configuration is omitted, and a plan priced only that way lists no
 *   configurations at all.
 *
 * Every amount comes through `PriceResolver` on a listing-kind channel, so the
 * same structural guarantee the meal surface has holds here: a negotiated
 * corporate or insurance tariff is unreachable, not merely unrequested.
 */
final readonly class MarketplacePlans
{
    public function __construct(
        private PriceResolver $prices,
        private DatabaseTenantContext $tenantContext,
    ) {}

    /**
     * @return Builder<CatalogueItem>
     */
    public function visible(): Builder
    {
        return CatalogueItem::withoutTenancy()
            ->where('item_type', CatalogueItemType::SubscriptionPlan->value)
            ->where('status', CatalogueItemStatus::Published->value)
            ->whereIn('organisation_id', app(MarketplaceKitchens::class)->visible()->select('organisations.id'));
    }

    /**
     * @param  Builder<CatalogueItem>  $query
     */
    public function whereTextMatches(Builder $query, string $term): void
    {
        $escaped = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $term).'%';

        $query->where(function (Builder $scoped) use ($escaped): void {
            $scoped->where('name_en', 'ilike', $escaped)
                ->orWhere('name_ar', 'ilike', $escaped)
                ->orWhere('description_en', 'ilike', $escaped)
                ->orWhere('description_ar', 'ilike', $escaped);
        });
    }

    /**
     * Plans with an active configuration serving this many meals a day.
     *
     * @param  Builder<CatalogueItem>  $query
     */
    public function whereMealsPerDay(Builder $query, int $mealsPerDay): void
    {
        $query->whereExists(fn ($exists) => $exists->from('plan_variant_profiles')
            ->join('catalogue_item_variants', 'catalogue_item_variants.id', '=', 'plan_variant_profiles.catalogue_item_variant_id')
            ->whereColumn('plan_variant_profiles.catalogue_item_id', 'catalogue_items.id')
            ->where('catalogue_item_variants.status', VariantStatus::Active->value)
            ->where('plan_variant_profiles.meals_per_day', $mealsPerDay));
    }

    /**
     * Plans offering a duration by its code.
     *
     * @param  Builder<CatalogueItem>  $query
     */
    public function whereOffersDuration(Builder $query, string $durationCode): void
    {
        $query->whereExists(fn ($exists) => $exists->from('plan_variant_durations')
            ->join('plan_durations', 'plan_durations.id', '=', 'plan_variant_durations.plan_duration_id')
            ->join('catalogue_item_variants', 'catalogue_item_variants.id', '=', 'plan_variant_durations.catalogue_item_variant_id')
            ->whereColumn('catalogue_item_variants.catalogue_item_id', 'catalogue_items.id')
            ->where('catalogue_item_variants.status', VariantStatus::Active->value)
            ->where('plan_variant_durations.is_available', true)
            ->where('plan_durations.is_active', true)
            ->where('plan_durations.code', $durationCode));
    }

    public function profileOf(CatalogueItem $plan): ?SubscriptionPlanProfile
    {
        $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($plan->getKey())->first();

        return $profile instanceof SubscriptionPlanProfile ? $profile : null;
    }

    /**
     * The plan's active configurations, each with the commercial cell behind it,
     * its energy band and its weekly price — dropping any the platform cannot
     * quote a weekly price for.
     *
     * @return list<array{
     *     variant: CatalogueItemVariant,
     *     profile: PlanVariantProfile,
     *     band: EnergyBand|null,
     *     price_per_week: ResolvedPrice|null,
     *     daily: ResolvedPrice|null
     * }>
     */
    public function configurationsOf(CatalogueItem $plan, ?PlanPricingBasis $basis): array
    {
        $variants = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $plan->getKey())
            ->where('variant_type', VariantType::PlanConfiguration->value)
            ->where('status', VariantStatus::Active->value)
            ->orderBy('code')
            ->get();

        if ($variants->isEmpty()) {
            return [];
        }

        $profiles = PlanVariantProfile::withoutTenancy()
            ->whereIn('catalogue_item_variant_id', $variants->modelKeys())
            ->get()
            ->keyBy(static fn (PlanVariantProfile $row): string => (string) $row->getKey());

        $bands = EnergyBand::withoutTenancy()
            ->whereIn('id', $profiles->pluck('energy_band_id')->filter()->unique()->all())
            ->get()
            ->keyBy(static fn (EnergyBand $band): string => (string) $band->getKey());

        $channels = app(MarketplaceMeals::class)->listingChannelsOf($plan->organisation_id);
        $configurations = [];

        foreach ($variants as $variant) {
            $profile = $profiles->get((string) $variant->getKey());

            if (! $profile instanceof PlanVariantProfile) {
                continue;
            }

            $resolved = $this->priceOf($plan, (string) $variant->getKey(), $channels);

            $configurations[] = [
                'variant' => $variant,
                'profile' => $profile,
                'band' => $profile->energy_band_id === null ? null : $bands->get($profile->energy_band_id),
                'price_per_week' => $resolved === null ? null : $this->perWeek($resolved, $basis),
                'daily' => $basis === PlanPricingBasis::PerDay ? $resolved : null,
            ];
        }

        return $configurations;
    }

    /**
     * The durations offered by a plan's active configurations.
     *
     * `discount_percent` is carried as the nullable decimal string the column
     * holds — NULL means nobody has stated a discount, which is a different
     * fact from stating there is none, and the model's own documentation
     * insists on the difference.
     *
     * Where two configurations offer the same duration on different terms, the
     * plan-level answer is `null` rather than one of them: a plan page showing
     * "10% off" when only the premium configuration gets it would be a price
     * claim the kitchen did not make.
     *
     * @param  list<array{variant: CatalogueItemVariant, profile: PlanVariantProfile, band: EnergyBand|null, price_per_week: ResolvedPrice|null, daily: ResolvedPrice|null}>  $configurations
     * @return list<array{duration: PlanDuration, discount_percent: string|null, ambiguous: bool}>
     */
    public function durationsOf(array $configurations): array
    {
        if ($configurations === []) {
            return [];
        }

        $variantIds = array_map(
            static fn (array $configuration): string => (string) $configuration['variant']->getKey(),
            $configurations,
        );

        $assignments = PlanVariantDuration::withoutTenancy()
            ->whereIn('catalogue_item_variant_id', $variantIds)
            ->where('is_available', true)
            ->get();

        if ($assignments->isEmpty()) {
            return [];
        }

        $durations = PlanDuration::withoutTenancy()
            ->whereIn('id', $assignments->pluck('plan_duration_id')->unique()->all())
            ->where('is_active', true)
            ->orderBy('display_order')
            ->orderBy('code')
            ->get();

        $offered = [];

        foreach ($durations as $duration) {
            $stated = $assignments
                ->where('plan_duration_id', (string) $duration->getKey())
                ->pluck('discount_percent')
                ->unique()
                ->values();

            if ($stated->isEmpty()) {
                continue;
            }

            $ambiguous = $stated->count() > 1;

            $offered[] = [
                'duration' => $duration,
                'discount_percent' => $ambiguous ? null : $stated->first(),
                'ambiguous' => $ambiguous,
            ];
        }

        return $offered;
    }

    /**
     * The whole-run price of one duration, when the platform can state one.
     *
     * Only a `per_day` plan on a `fixed_days` duration has all three numbers —
     * a confirmed daily price, a stated number of days, and a discount that is
     * either stated or absent. Anything else returns null rather than a figure
     * assembled from a missing part. The rounding is half-up to the minor unit
     * and is applied once, at the end, so a discount never compounds a rounding
     * error across days.
     */
    public function totalFor(?ResolvedPrice $daily, PlanDuration $duration, ?string $discountPercent): ?ResolvedPrice
    {
        if ($daily === null || $duration->duration_kind !== PlanDurationKind::FixedDays) {
            return null;
        }

        $days = $duration->duration_days;

        if ($days === null || $days <= 0) {
            return null;
        }

        $gross = $daily->amountMinor * $days;
        $discount = $discountPercent === null ? 0.0 : (float) $discountPercent;
        $net = (int) round($gross * (1 - ($discount / 100)));

        return new ResolvedPrice(
            amountMinor: $net,
            currencyCode: $daily->currencyCode,
            priceListId: $daily->priceListId,
            priceListItemId: $daily->priceListItemId,
        );
    }

    /**
     * The confirmed price of one configuration, through a listing channel.
     *
     * @param  list<SalesChannel>  $channels
     */
    private function priceOf(CatalogueItem $plan, string $variantId, array $channels): ?ResolvedPrice
    {
        if ($channels === []) {
            return null;
        }

        return $this->tenantContext->during(null, $plan->organisation_id, null, function () use ($plan, $variantId, $channels): ?ResolvedPrice {
            foreach ($channels as $channel) {
                $price = $this->prices->currentFor((string) $channel->getKey(), (string) $plan->getKey(), $variantId);

                if ($price instanceof ResolvedPrice) {
                    return $price;
                }
            }

            return null;
        });
    }

    /**
     * The weekly figure, or null when the plan's basis cannot produce one.
     */
    private function perWeek(ResolvedPrice $price, ?PlanPricingBasis $basis): ?ResolvedPrice
    {
        return match ($basis) {
            PlanPricingBasis::PerWeek => $price,
            PlanPricingBasis::PerDay => new ResolvedPrice(
                amountMinor: $price->amountMinor * 7,
                currencyCode: $price->currencyCode,
                priceListId: $price->priceListId,
                priceListItemId: $price->priceListItemId,
            ),
            PlanPricingBasis::Total, null => null,
        };
    }
}
