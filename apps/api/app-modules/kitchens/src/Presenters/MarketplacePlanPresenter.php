<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Presenters;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Pricing\Services\ResolvedPrice;

/**
 * The public projection of a published subscription plan (master plan v2 §4.8).
 *
 * ## The duration shape is a documented widening
 *
 * The proposed draft typed a duration as one of four strings — `1w`, `2w`,
 * `4w`, `12w`. The platform does not store durations that way and will not:
 * §4.3 replaced the zero-day sentinel with an explicit
 * `duration_kind` (`one_off` | `fixed_days`) and a nullable `duration_days`,
 * precisely so that "not a subscription, just one order" stops being a magic
 * number that a per-day calculation divides by. GreenLife's real runs are 5, 20,
 * 40 and 60 days; not one of them is expressible in the draft's enumeration.
 *
 * So `PlanDurationOption` here carries `kind`, `days`, the kitchen's own `code`
 * and its localised `name` — the amendment recorded against OD-3 — and a client
 * renders "20 days" from the number rather than from a label it guessed.
 *
 * ## Money that is absent rather than assembled
 *
 * `discount_percent` is `null` when nobody stated one, and `null` again when two
 * configurations state different ones. `total_price` is `null` unless the plan
 * is priced per day over a fixed run, which is the only combination where every
 * number in the multiplication is a number somebody agreed to. Both nulls are
 * the same principle: a plan page may say nothing, but it may not say a figure
 * no kitchen quoted.
 *
 * ## Fields the platform has no data for
 *
 * `category_slugs` is `[]` — nothing groups plans into marketing categories.
 * `sample_meal_ids` is `[]` — there is no table linking a plan to the meals a
 * representative week would contain, and assembling one from the kitchen's
 * catalogue would be the system writing a menu.
 */
final class MarketplacePlanPresenter
{
    /**
     * @param  list<string>  $dietClassifications
     * @param  list<array{
     *     variant: CatalogueItemVariant,
     *     profile: PlanVariantProfile,
     *     band: EnergyBand|null,
     *     price_per_week: ResolvedPrice|null,
     *     daily: ResolvedPrice|null
     * }>  $configurations
     * @param  list<array{duration: PlanDuration, discount_percent: string|null, total_price: ResolvedPrice|null}>  $durations
     * @return array<string, mixed>
     */
    public function plan(
        CatalogueItem $plan,
        ?SubscriptionPlanProfile $profile,
        string $locale,
        array $dietClassifications,
        array $configurations,
        array $durations,
    ): array {
        return [
            'id' => (string) $plan->getKey(),
            'kitchen_id' => $plan->organisation_id,
            'name' => MarketplaceLocale::pick($locale, $plan->name_en, $plan->name_ar),
            'slug' => $plan->slug,
            'summary' => $profile === null
                ? ''
                : MarketplaceLocale::pick($locale, $profile->summary_en, $profile->summary_ar),
            'description' => MarketplaceLocale::pick($locale, $plan->description_en, $plan->description_ar),
            'category_slugs' => [],
            'diet_classifications' => $dietClassifications,
            'variants' => array_values(array_map(
                fn (array $configuration): array => $this->variant($configuration, (string) $plan->getKey(), $locale),
                array_filter(
                    $configurations,
                    static fn (array $configuration): bool => $configuration['price_per_week'] instanceof ResolvedPrice,
                ),
            )),
            'durations' => array_map(
                fn (array $duration): array => $this->duration($duration, $locale),
                $durations,
            ),
            'sample_meal_ids' => [],
            'image_placeholder_id' => 'plan-'.$plan->slug,
            'rating' => null,
            'rating_count' => 0,
        ];
    }

    /**
     * @param  array{variant: CatalogueItemVariant, profile: PlanVariantProfile, band: EnergyBand|null, price_per_week: ResolvedPrice|null, daily: ResolvedPrice|null}  $configuration
     * @return array<string, mixed>
     */
    private function variant(array $configuration, string $planId, string $locale): array
    {
        $band = $configuration['band'];
        $price = $configuration['price_per_week'];

        return [
            'id' => (string) $configuration['variant']->getKey(),
            'plan_id' => $planId,
            'name' => MarketplaceLocale::pick(
                $locale,
                $configuration['variant']->name_en,
                $configuration['variant']->name_ar,
            ),

            // A band, never a per-person target: a single number would imply an
            // energy calculation this programme does not do (§2.4). A
            // configuration with no band carries null rather than a made-up
            // range.
            'energy_range' => $band === null ? null : ['min' => $band->min_kcal, 'max' => $band->max_kcal],
            'protein_range' => null,
            'carbohydrate_range' => null,
            'fat_range' => null,
            'meals_per_day' => $configuration['profile']->meals_per_day,
            'snacks_per_day' => $configuration['profile']->snacks_per_day,
            'price_per_week' => $price === null
                ? null
                : ['amount' => $price->amountMinor, 'currency' => $price->currencyCode],
        ];
    }

    /**
     * @param  array{duration: PlanDuration, discount_percent: string|null, total_price: ResolvedPrice|null}  $offered
     * @return array<string, mixed>
     */
    private function duration(array $offered, string $locale): array
    {
        $duration = $offered['duration'];
        $total = $offered['total_price'];

        return [
            'code' => $duration->code,
            'name' => MarketplaceLocale::pick($locale, $duration->name_en, $duration->name_ar),
            'kind' => $duration->duration_kind->value,
            'days' => $duration->duration_days,
            'discount_percent' => $offered['discount_percent'],
            'total_price' => $total === null
                ? null
                : ['amount' => $total->amountMinor, 'currency' => $total->currencyCode],
        ];
    }
}
