<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\PlanDurationKind;
use Healthy360\Catalogues\Enums\PlanPricingBasis;
use Healthy360\Catalogues\Enums\PlanType;
use Healthy360\Catalogues\Enums\ServiceTier;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Catalogues\Services\CatalogueItemReadiness;
use Healthy360\Catalogues\Services\PlanVariantService;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\ReferenceData\Models\DietClassification;
use Illuminate\Support\Facades\App;
use RuntimeException;

/**
 * Writes one preview subscription plan — vocabulary, matrix, durations, prices,
 * diets — and publishes it only if the readiness gate agrees.
 *
 * ## Why this is a class and not four more private methods on a seeder
 *
 * `DemoTenantSeeder` already owns a plan-writing vocabulary
 * (`combination()`, `energyBand()`, `planDuration()`, `planConfiguration()`,
 * `planDurationAssignment()`), and the obvious move would be to make those
 * public and call them. It is the wrong move: those helpers are the shape of
 * *that* seeder's one deliberately-unpublishable fixture, and widening them
 * into a shared API would let a change made for the preview world silently
 * rewrite the demonstration plan the publish-gate tests are pinned to. The
 * mechanics are mirrored here instead — same tables, same derived codes, same
 * `updateOrCreate` keys — and the duplication is the seam that keeps the two
 * fixtures independently editable.
 *
 * ## The matrix cell, and the one plan that does not fit it
 *
 * A configuration is identified by a cell: one meal combination, one service
 * tier, one energy band. `plan_variant_profiles` enforces that with a unique
 * index, and {@see PlanVariantService} refuses
 * a second configuration at an occupied address.
 *
 * Seven of the eight fixture plans separate their three variants by energy
 * band, so each lands in its own cell without any help. `everyday-family-box`
 * does not: its three variants are the *same* dinner at the same energy band
 * for two, three or four people. Household size is a real distinction the
 * matrix has no coordinate for, so it is modelled as three distinct meal
 * combinations (`family-dinner-2`, `-3`, `-4`) rather than by inventing three
 * fictitious calorie bands — a fabricated energy range would be a nutrition
 * claim, and household size is not one.
 *
 * ## `per_day`, derived from the weekly figure
 *
 * The fixture states a weekly price, but the storefront quoting engine
 * (`StorefrontQuoting`) refuses any basis other than `per_day` with
 * `subscription.refused / pricing_basis_unsupported` — a `per_week` plan lists
 * on the marketplace and then cannot be subscribed to at all. So the seeder
 * stores the derived daily figure, `round(weekly / 7)`, and accepts the
 * consequence it implies: the presenter's `price_per_week` (daily × 7) can
 * drift from the fixture's weekly number by up to three minor units. A
 * subscription that can actually be started beats a headline that matches a
 * retired fixture to the fils.
 */
final class PlanFixtureWriter
{
    /**
     * The client's closed duration vocabulary (1w/2w/4w/12w), as the platform
     * stores it: a code, a kind and a number of days.
     *
     * @var array<string, array{int, string, string, int}> code → [days, name_en, name_ar, display_order]
     */
    private const array DURATIONS = [
        'days-7' => [7, '7 days', '٧ أيام', 1],
        'days-14' => [14, '14 days', '١٤ يوماً', 2],
        'days-28' => [28, '28 days', '٢٨ يوماً', 3],
        'days-84' => [84, '84 days', '٨٤ يوماً', 4],
    ];

    /**
     * The meal combinations the fixture's variants sit on, keyed by the number
     * of meals a day they deliver.
     *
     * @var array<int, array{string, string, string, bool, bool, bool}> meals → [code, name_en, name_ar, breakfast, lunch, dinner]
     */
    private const array COMBINATIONS = [
        1 => ['lunch-only', 'Lunch only', 'الغداء فقط', false, true, false],
        3 => ['full-day', 'Full day', 'اليوم الكامل', true, true, true],
        4 => ['full-day-plus', 'Full day plus', 'اليوم الكامل مع إضافة', true, true, true],
        5 => ['full-day-athlete', 'Full day, five sittings', 'اليوم الكامل بخمس وجبات', true, true, true],
    ];

    /**
     * Household sizes for `everyday-family-box`, indexed by variant position.
     *
     * @var array<int, array{string, string, string}> index → [code, name_en, name_ar]
     */
    private const array HOUSEHOLDS = [
        0 => ['family-dinner-2', 'Dinner for two', 'عشاء لشخصين'],
        1 => ['family-dinner-3', 'Dinner for three', 'عشاء لثلاثة أشخاص'],
        2 => ['family-dinner-4', 'Dinner for four', 'عشاء لأربعة أشخاص'],
    ];

    /** The plan whose variants differ by household size rather than by band. */
    private const string HOUSEHOLD_PLAN = 'everyday-family-box';

    /**
     * @param  array<string, mixed>  $fixture  one row of prototype_marketplace_plans.php
     */
    public function write(
        Organisation $kitchen,
        Catalogue $catalogue,
        PriceList $tariff,
        array $fixture,
        User $owner,
    ): CatalogueItem {
        $slug = (string) $fixture['slug'];

        $plan = CatalogueItem::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'slug' => $slug],
            [
                'catalogue_id' => $catalogue->getKey(),
                'item_type' => CatalogueItemType::SubscriptionPlan,
                'name_en' => (string) $fixture['name'],
                // English display copy is all the prototype supplied. A visible
                // marker keeps the plan publishable while making the remaining
                // localisation work obvious in Arabic preview mode, rather than
                // machine-translating commercial terms.
                'name_ar' => 'خطة تجريبية: '.$fixture['name'],
                'status' => CatalogueItemStatus::Draft,
                'created_by' => $owner->getKey(),
                'updated_by' => $owner->getKey(),
            ],
        );

        $plan->forceFill([
            'description_en' => (string) $fixture['description'],
            'description_ar' => 'وصف تجريبي — تحتاج هذه الخطة إلى وصف عربي مراجع.',
            'image_placeholder_id' => 'plan-'.$slug,
        ])->save();

        SubscriptionPlanProfile::withoutTenancy()->updateOrCreate(
            ['catalogue_item_id' => $plan->getKey()],
            [
                'organisation_id' => $kitchen->getKey(),
                'plan_type' => PlanType::Both,

                // `per_day`, not the fixture's weekly framing: the storefront
                // quoting engine supports no other basis, and a plan that
                // cannot be quoted cannot be subscribed to. See the class
                // docblock for the derivation and its ≤3-fils weekly drift.
                'pricing_basis' => PlanPricingBasis::PerDay,
                'allows_free_selection' => false,
                'skip_allowed' => true,
                'pause_allowed' => true,
                'change_cutoff_hours' => 24,
                'summary_en' => (string) $fixture['summary'],
                'summary_ar' => 'ملخص تجريبي — يحتاج إلى مراجعة عربية.',
            ],
        );

        $durations = $this->durations($kitchen, $owner);

        /** @var list<array<string, mixed>> $variants */
        $variants = $fixture['variants'];

        /** @var list<string> $liveCodes */
        $liveCodes = [];

        foreach ($variants as $index => $variantFixture) {
            $configuration = $this->configuration($plan, $kitchen, $slug, $index, $variantFixture, $owner);
            $liveCodes[] = $configuration->code;

            /** @var list<array<string, mixed>> $durationFixtures */
            $durationFixtures = $fixture['durations'];

            foreach ($durationFixtures as $durationFixture) {
                PlanVariantDuration::withoutTenancy()->updateOrCreate(
                    [
                        'catalogue_item_variant_id' => $configuration->getKey(),
                        'plan_duration_id' => $durations[(string) $durationFixture['code']]->getKey(),
                    ],
                    [
                        'organisation_id' => $kitchen->getKey(),
                        'discount_percent' => (string) $durationFixture['discount_percent'],
                        'is_available' => true,
                        'created_by' => $owner->getKey(),
                    ],
                );
            }

            PriceListItem::withoutTenancy()->updateOrCreate(
                [
                    'price_list_id' => $tariff->getKey(),
                    'catalogue_item_id' => $plan->getKey(),
                    'catalogue_item_variant_id' => $configuration->getKey(),
                    'min_quantity' => null,
                    'effective_to' => null,
                ],
                [
                    'organisation_id' => $kitchen->getKey(),
                    // The confirmed standing price is per day (the plan's basis),
                    // derived once from the fixture's weekly figure.
                    'unit_amount_minor' => (int) round(((int) $variantFixture['price_per_week_minor']) / 7),
                    'price_status' => PriceStatus::Confirmed,
                    'effective_from' => now()->toDateString(),
                    'created_by' => $owner->getKey(),
                ],
            );
        }

        $this->archiveSupersededConfigurations($plan, $liveCodes);

        /** @var list<string> $diets */
        $diets = $fixture['diets'];

        foreach ($diets as $code) {
            $classification = DietClassification::query()->where('code', $code)->sole();

            CatalogueItemDietClassification::withoutTenancy()->updateOrCreate(
                [
                    'catalogue_item_id' => $plan->getKey(),
                    'diet_classification_id' => $classification->getKey(),
                ],
                ['organisation_id' => $kitchen->getKey()],
            );
        }

        // Re-read: the readiness evaluator queries by identifier, and the
        // in-memory model is stale about the rows just written beneath it.
        $plan->refresh();

        $reasons = App::make(CatalogueItemReadiness::class)->reasons($plan);

        if ($reasons !== []) {
            throw new RuntimeException(sprintf(
                'The preview plan %s is not ready to publish: %s. A seeder must never publish past the gate.',
                $slug,
                implode(', ', array_column($reasons, 'code')),
            ));
        }

        $plan->forceFill(['status' => CatalogueItemStatus::Published])->save();

        return $plan;
    }

    /**
     * One matrix cell: the variant a price points at, plus the profile that
     * says which cell it is.
     *
     * The code is what `PlanVariantService` derives for the same coordinates —
     * `{combination}-{tier}-{band}` — so the seeded data and the API agree
     * about identity.
     *
     * @param  array<string, mixed>  $fixture
     */
    private function configuration(
        CatalogueItem $plan,
        Organisation $kitchen,
        string $planSlug,
        int $index,
        array $fixture,
        User $owner,
    ): CatalogueItemVariant {
        $combination = $this->combinationFor($kitchen, $planSlug, $index, (int) $fixture['meals_per_day'], $owner);
        $band = $this->energyBand($kitchen, (int) $fixture['energy_min'], (int) $fixture['energy_max'], $owner);

        // Two standard tiers and one premium: the fixture's third variant is
        // the larger, dearer one in every plan, and the tier vocabulary has
        // exactly two values.
        $tier = $index === 2 ? ServiceTier::Premium : ServiceTier::Standard;

        $code = $combination->code.'-'.$tier->value.'-'.$band->code;

        $variant = CatalogueItemVariant::withoutTenancy()->updateOrCreate(
            ['catalogue_item_id' => $plan->getKey(), 'code' => $code],
            [
                'organisation_id' => $kitchen->getKey(),
                'variant_type' => VariantType::PlanConfiguration,
                'name_en' => (string) $fixture['name'],
                'name_ar' => null,
                'is_default' => false,
                'status' => VariantStatus::Active,
                'created_by' => $owner->getKey(),
                'updated_by' => $owner->getKey(),
            ],
        );

        $snacks = (int) $fixture['snacks_per_day'];

        PlanVariantProfile::withoutTenancy()->updateOrCreate(
            ['catalogue_item_variant_id' => $variant->getKey()],
            [
                'organisation_id' => $kitchen->getKey(),
                'catalogue_item_id' => $plan->getKey(),
                'meal_combination_option_id' => $combination->getKey(),
                'energy_band_id' => $band->getKey(),
                'service_tier' => $tier,
                'includes_snacks' => $snacks > 0,
                'meals_per_day' => (int) $fixture['meals_per_day'],
                'snacks_per_day' => $snacks,
            ],
        );

        return $variant;
    }

    /**
     * The combination a variant sits on: normally the one that matches its
     * meals a day, and for the household plan a distinct row per household
     * size so three otherwise-identical variants occupy three cells.
     */
    private function combinationFor(
        Organisation $kitchen,
        string $planSlug,
        int $index,
        int $mealsPerDay,
        User $owner,
    ): MealCombinationOption {
        if ($planSlug === self::HOUSEHOLD_PLAN) {
            [$code, $nameEn, $nameAr] = self::HOUSEHOLDS[$index];

            return $this->combination($kitchen, $code, $nameEn, $nameAr, false, false, true, 1, 10 + $index, $owner);
        }

        $shape = self::COMBINATIONS[$mealsPerDay] ?? throw new RuntimeException(
            'No preview meal combination is defined for '.$mealsPerDay.' meals a day.',
        );

        [$code, $nameEn, $nameAr, $breakfast, $lunch, $dinner] = $shape;

        return $this->combination($kitchen, $code, $nameEn, $nameAr, $breakfast, $lunch, $dinner, $mealsPerDay, $mealsPerDay, $owner);
    }

    private function combination(
        Organisation $kitchen,
        string $code,
        string $nameEn,
        string $nameAr,
        bool $breakfast,
        bool $lunch,
        bool $dinner,
        int $mealsPerDay,
        int $displayOrder,
        User $owner,
    ): MealCombinationOption {
        return MealCombinationOption::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'code' => $code],
            [
                'name_en' => $nameEn,
                'name_ar' => $nameAr,
                'includes_breakfast' => $breakfast,
                'includes_lunch' => $lunch,
                'includes_dinner' => $dinner,
                'meals_per_day' => $mealsPerDay,
                'display_order' => $displayOrder,
                'is_active' => true,
                'created_by' => $owner->getKey(),
            ],
        );
    }

    private function energyBand(Organisation $kitchen, int $min, int $max, User $owner): EnergyBand
    {
        return EnergyBand::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $kitchen->getKey(), 'code' => 'kcal-'.$min.'-'.$max],
            [
                'name_en' => $min.'–'.$max.' kcal',
                'name_ar' => $this->arabicDigits((string) $min).'–'.$this->arabicDigits((string) $max).' سعرة',
                'min_kcal' => $min,
                'max_kcal' => $max,
                'display_order' => intdiv($min, 100),
                'is_active' => true,
                'created_by' => $owner->getKey(),
            ],
        );
    }

    /**
     * The four fixed runs every preview plan offers, created once per kitchen.
     *
     * @return array<string, PlanDuration>
     */
    private function durations(Organisation $kitchen, User $owner): array
    {
        $durations = [];

        foreach (self::DURATIONS as $code => [$days, $nameEn, $nameAr, $displayOrder]) {
            $durations[$code] = PlanDuration::withoutTenancy()->updateOrCreate(
                ['organisation_id' => $kitchen->getKey(), 'code' => $code],
                [
                    'duration_kind' => PlanDurationKind::FixedDays,
                    'duration_days' => $days,
                    'name_en' => $nameEn,
                    'name_ar' => $nameAr,
                    'display_order' => $displayOrder,
                    'is_active' => true,
                    'created_by' => $owner->getKey(),
                ],
            );
        }

        return $durations;
    }

    /**
     * Archive every configuration on this plan the fixture no longer states.
     *
     * `balanced-week` is the case this exists for: `DemoTenantSeeder` builds it
     * with two configurations of its own, and re-authoring the matrix from the
     * fixture would otherwise leave five active cells on a three-variant plan.
     * Archived rather than deleted, because a price already points at each of
     * them and archiving is what the variant lifecycle means by "withdrawn":
     * `configurationsOf()` reads active rows only, so the consumer surface
     * shows the three the fixture states and nothing else.
     *
     * @param  list<string>  $liveCodes
     */
    private function archiveSupersededConfigurations(CatalogueItem $plan, array $liveCodes): void
    {
        $superseded = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $plan->getKey())
            ->where('variant_type', VariantType::PlanConfiguration->value)
            ->where('status', VariantStatus::Active->value)
            ->whereNotIn('code', $liveCodes)
            ->get();

        foreach ($superseded as $variant) {
            $variant->forceFill(['status' => VariantStatus::Archived])->save();
        }
    }

    /**
     * Eastern Arabic numerals, matching how `DemoTenantSeeder` writes a band's
     * Arabic name.
     */
    private function arabicDigits(string $value): string
    {
        return str_replace(
            ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
            ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'],
            $value,
        );
    }
}
