<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

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
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Illuminate\Support\Str;

/**
 * The seven commercial plans, their vocabularies and the configuration matrix
 * the workbook's availability grid describes.
 *
 * **No plan can be published, and that is the import working correctly.** The
 * source's "Plan Pricing (per day)" sheet is a grid of `Y` flags with a footnote
 * saying prices are daily and discounts depend on the number of days — and not
 * one number anywhere. So every configuration gets a `placeholder` price row
 * with a NULL amount on the draft `healthy360-plans-usd` tariff, the publish gate
 * refuses the plan with `plan_prices_incomplete` naming every unpriced
 * configuration, and the readiness endpoint says the same thing without anybody
 * having to attempt a publication (decision OD-2, reviewer point 15). A zero
 * would have been a price. A missing row would have been an omission somebody
 * would eventually "fix" by guessing. A NULL-amount placeholder is the schema
 * saying, in a column with a CHECK behind it, *we have not priced this*.
 *
 * **Nine combination options, twelve configurations.** The workbook lists its
 * meal-combination options on one sheet and prices a different set of columns on
 * another: the options sheet has Free Selection and four pairings, the pricing
 * sheet has four single meal types and the same four pairings at two service
 * tiers. Both are true, and they are two different axes — *what meals* and *at
 * what tier* — so the combination vocabulary is their union (nine rows) and the
 * tier lives on the variant. Business Lunch comes out with exactly two
 * configurations, Lunch and Snack, because those are the only two cells its row
 * marks `Y`.
 *
 * **Free Selection has no configuration**, because the pricing sheet has no
 * column for it. It stays in the vocabulary, where an operator can build one.
 *
 * **The meal-to-plan map is not imported at all.** The source labels that sheet
 * "EXAMPLE data — validate" in its own title. Importing it would put a
 * fabricated menu behind seven real plans, and the fact that it was illustrative
 * would survive exactly as long as the person who read the title.
 */
final readonly class PlanWriter
{
    /**
     * The workbook's own subscription rule, in the column that enforces it:
     * "choose which days, skip, or pause (up to 24 hours before delivery)".
     */
    private const int CHANGE_CUTOFF_HOURS = 24;

    public function __construct(private string $sourceSystem) {}

    /**
     * @param  array<string, mixed>  $parsed
     * @param  array<string, PriceList>  $priceLists
     */
    public function write(
        array $parsed,
        string $organisationId,
        Catalogue $catalogue,
        array $priceLists,
        ImportReport $report,
    ): void {
        /** @var list<array{code: string, detail: string}> $findings */
        $findings = $parsed['findings'];
        $report->findings($findings, SourceManifest::PLANS);

        /** @var array{imported: bool, row_count: int, reason: string} $mealMap */
        $mealMap = $parsed['meal_map'];

        $report->knownGap(
            'meal_to_plan_map_not_imported',
            sprintf(
                'The meal-to-plan map (%d rows) was not imported. %s',
                $mealMap['row_count'],
                $mealMap['reason'],
            ),
        );

        $report->knownGap(
            'plan_prices_are_placeholders',
            'Every plan configuration carries a NULL-amount placeholder price. The workbook prices nothing — '
            .'its pricing sheet is availability flags and a footnote. No plan can be published until a human '
            .'supplies the numbers.',
        );

        $report->knownGap(
            'plan_duration_discounts_absent',
            'Every duration assignment carries a NULL discount. The workbook says discounts apply for longer '
            .'commitments and gives no percentages.',
        );

        $combinations = $this->writeCombinations($parsed, $organisationId, $report);
        $bands = $this->writeEnergyBands($parsed, $organisationId, $report);
        $durations = $this->writeDurations($parsed, $organisationId, $report);

        unset($bands);

        $this->writePlans($parsed, $organisationId, $catalogue, $combinations, $durations, $priceLists, $report);
    }

    /**
     * @param  array<string, mixed>  $parsed
     * @return array<string, string> combination code → id
     */
    private function writeCombinations(array $parsed, string $organisationId, ImportReport $report): array
    {
        /** @var list<array{code: string, name: string, includes_breakfast: bool, includes_lunch: bool, includes_dinner: bool, meals_per_day: int, is_free_selection: bool}> $rows */
        $rows = $parsed['combinations'];

        /** @var array<string, string> $ids */
        $ids = MealCombinationOption::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->pluck('id', 'code')
            ->all();

        foreach ($rows as $index => $row) {
            if (isset($ids[$row['code']])) {
                $report->skipped('meal_combination_option');

                continue;
            }

            $option = new MealCombinationOption;
            $option->organisation_id = $organisationId;
            $option->code = $row['code'];
            $option->name_en = $row['name'];
            $option->name_ar = $row['name'];
            $option->includes_breakfast = $row['includes_breakfast'];
            $option->includes_lunch = $row['includes_lunch'];
            $option->includes_dinner = $row['includes_dinner'];
            $option->meals_per_day = $row['meals_per_day'];
            $option->display_order = $index + 1;
            $option->is_active = true;
            $option->save();

            $ids[$row['code']] = (string) $option->getKey();
            $report->created('meal_combination_option');
        }

        return $ids;
    }

    /**
     * @param  array<string, mixed>  $parsed
     * @return array<string, string>
     */
    private function writeEnergyBands(array $parsed, string $organisationId, ImportReport $report): array
    {
        /** @var list<array{code: string, name: string, min_kcal: int, max_kcal: int}> $rows */
        $rows = $parsed['energy_bands'];

        /** @var array<string, string> $ids */
        $ids = EnergyBand::withoutTenancy()->where('organisation_id', $organisationId)->pluck('id', 'code')->all();

        foreach ($rows as $index => $row) {
            if (isset($ids[$row['code']])) {
                $report->skipped('energy_band');

                continue;
            }

            $band = new EnergyBand;
            $band->organisation_id = $organisationId;
            $band->code = $row['code'];
            $band->name_en = $row['name'];
            $band->name_ar = $row['name'];
            $band->min_kcal = $row['min_kcal'];
            $band->max_kcal = $row['max_kcal'];
            $band->display_order = $index + 1;
            $band->is_active = true;
            $band->save();

            $ids[$row['code']] = (string) $band->getKey();
            $report->created('energy_band');
        }

        return $ids;
    }

    /**
     * @param  array<string, mixed>  $parsed
     * @return array<string, string>
     */
    private function writeDurations(array $parsed, string $organisationId, ImportReport $report): array
    {
        /** @var list<array{code: string, name: string, kind: string, days: int|null}> $rows */
        $rows = $parsed['durations'];

        /** @var array<string, string> $ids */
        $ids = PlanDuration::withoutTenancy()->where('organisation_id', $organisationId)->pluck('id', 'code')->all();

        foreach ($rows as $index => $row) {
            if (isset($ids[$row['code']])) {
                $report->skipped('plan_duration');

                continue;
            }

            $duration = new PlanDuration;
            $duration->organisation_id = $organisationId;
            $duration->code = $row['code'];
            $duration->duration_kind = PlanDurationKind::from($row['kind']);

            // Never a zero-day row (master plan v2 §4.3). The workbook writes
            // "No subscription | 0", and 0 days is not a length — it is the
            // absence of a subscription, which is what `one_off` says.
            $duration->duration_days = $row['days'];
            $duration->name_en = $row['name'];
            $duration->name_ar = $row['name'];
            $duration->display_order = $index + 1;
            $duration->is_active = true;
            $duration->save();

            $ids[$row['code']] = (string) $duration->getKey();
            $report->created('plan_duration');
        }

        return $ids;
    }

    /**
     * @param  array<string, mixed>  $parsed
     * @param  array<string, string>  $combinations
     * @param  array<string, string>  $durations
     * @param  array<string, PriceList>  $priceLists
     */
    private function writePlans(
        array $parsed,
        string $organisationId,
        Catalogue $catalogue,
        array $combinations,
        array $durations,
        array $priceLists,
        ImportReport $report,
    ): void {
        /** @var list<array{plan_id: string, name: string, plan_type: string, plan_type_verbatim: string, status: string, notes: string|null}> $plans */
        $plans = $parsed['plans'];
        /** @var list<array{column: string, combination_code: string, tier: string, includes_snacks: bool, meals_per_day: int, snacks_per_day: int}> $columns */
        $columns = $parsed['variant_columns'];
        /** @var list<array{plan_name: string, column: string, available: bool}> $matrix */
        $matrix = $parsed['variant_matrix'];

        $planList = $priceLists[KitchenWorkbookWorld::PRICE_LIST_PLANS] ?? null;

        foreach ($plans as $plan) {
            $sourceRef = SourceManifest::PLANS.'#'.$plan['plan_id'];

            $existing = CatalogueItem::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('source_system', $this->sourceSystem)
                ->where('source_ref', $sourceRef)
                ->first();

            if ($existing instanceof CatalogueItem) {
                // As with products, the item is the unit of idempotency and its
                // configurations, profiles, duration assignments and
                // placeholder prices are counted as skipped so the re-run
                // report says what was protected rather than only that one row
                // was.
                $variantIds = CatalogueItemVariant::withoutTenancy()
                    ->where('catalogue_item_id', $existing->getKey())
                    ->pluck('id');

                $report->skipped('catalogue_item');
                $report->skipped('subscription_plan_profile');
                $report->skipped('catalogue_item_variant', $variantIds->count());
                $report->skipped('plan_variant_profile', $variantIds->count());
                $report->skipped('plan_variant_duration', PlanVariantDuration::withoutTenancy()
                    ->whereIn('catalogue_item_variant_id', $variantIds)
                    ->count());
                $report->skipped('price_list_item', PriceListItem::withoutTenancy()
                    ->where('catalogue_item_id', $existing->getKey())
                    ->count());

                continue;
            }

            $item = new CatalogueItem;
            $item->organisation_id = $organisationId;
            $item->catalogue_id = (string) $catalogue->getKey();
            $item->item_type = CatalogueItemType::SubscriptionPlan;
            $item->slug = Str::slug($plan['plan_id'].' '.$plan['name']);
            $item->name_en = trim($plan['name']);
            $item->name_ar = trim($plan['name']);
            $item->status = CatalogueItemStatus::Draft;
            $item->source_system = $this->sourceSystem;
            $item->source_ref = $sourceRef;
            $item->seeded_at = now();
            $item->lock_version = 0;
            $item->save();

            $report->created('catalogue_item');

            $profile = new SubscriptionPlanProfile;
            $profile->catalogue_item_id = (string) $item->getKey();
            $profile->organisation_id = $organisationId;
            $profile->plan_type = PlanType::from($plan['plan_type']);
            $profile->pricing_basis = PlanPricingBasis::PerDay;

            // False, and reported. The workbook lists Free Selection among its
            // combination options and gives it no column in the pricing matrix,
            // so no plan is recorded as offering it rather than all seven being
            // recorded as offering something nobody priced.
            $profile->allows_free_selection = false;
            $profile->skip_allowed = true;
            $profile->pause_allowed = true;
            $profile->change_cutoff_hours = self::CHANGE_CUTOFF_HOURS;
            $profile->summary_en = $plan['notes'];
            $profile->summary_ar = null;
            $profile->save();

            $report->created('subscription_plan_profile');

            $this->writeConfigurations(
                $item,
                $plan,
                $columns,
                $matrix,
                $combinations,
                $durations,
                $planList,
                $organisationId,
                $report,
            );
        }

        $report->knownGap(
            'plan_free_selection_unoffered',
            'The workbook lists "Free Selection" as a meal-combination option and its pricing matrix has no '
            .'column for it. The vocabulary row exists; no plan is marked as allowing free selection.',
        );
    }

    /**
     * @param  array{plan_id: string, name: string, plan_type: string, plan_type_verbatim: string, status: string, notes: string|null}  $plan
     * @param  list<array{column: string, combination_code: string, tier: string, includes_snacks: bool, meals_per_day: int, snacks_per_day: int}>  $columns
     * @param  list<array{plan_name: string, column: string, available: bool}>  $matrix
     * @param  array<string, string>  $combinations
     * @param  array<string, string>  $durations
     */
    private function writeConfigurations(
        CatalogueItem $item,
        array $plan,
        array $columns,
        array $matrix,
        array $combinations,
        array $durations,
        ?PriceList $planList,
        string $organisationId,
        ImportReport $report,
    ): void {
        $planKey = IngredientAlias::normalise($plan['name']);
        $available = [];

        foreach ($matrix as $cell) {
            if (IngredientAlias::normalise($cell['plan_name']) === $planKey && $cell['available']) {
                $available[$cell['column']] = true;
            }
        }

        foreach ($columns as $column) {
            if (! isset($available[$column['column']])) {
                continue;
            }

            $combinationId = $combinations[$column['combination_code']] ?? null;

            if ($combinationId === null) {
                $report->failed('plan_variant_profile');
                $report->finding(
                    'plan_combination_missing',
                    sprintf('"%s" offers the "%s" configuration and no combination option "%s" exists.', $plan['name'], $column['column'], $column['combination_code']),
                    SourceManifest::PLANS,
                );

                continue;
            }

            $code = Str::slug($column['column']);

            $variant = new CatalogueItemVariant;
            $variant->organisation_id = $organisationId;
            $variant->catalogue_item_id = (string) $item->getKey();
            $variant->variant_type = VariantType::PlanConfiguration;
            $variant->code = $code;
            $variant->name_en = $column['column'];
            $variant->name_ar = $column['column'];
            $variant->is_default = false;
            $variant->status = VariantStatus::Active;
            $variant->lock_version = 0;
            $variant->save();

            $report->created('catalogue_item_variant');

            $variantProfile = new PlanVariantProfile;
            $variantProfile->catalogue_item_variant_id = (string) $variant->getKey();
            $variantProfile->organisation_id = $organisationId;
            $variantProfile->catalogue_item_id = (string) $item->getKey();
            $variantProfile->meal_combination_option_id = $combinationId;

            // No energy band on the configuration. The workbook's bands "impact
            // price" and its pricing matrix has one axis, not two, so which band
            // a configuration is for is a decision nobody has recorded.
            $variantProfile->energy_band_id = null;
            $variantProfile->service_tier = ServiceTier::from($column['tier']);
            $variantProfile->includes_snacks = $column['includes_snacks'];
            $variantProfile->meals_per_day = $column['meals_per_day'];
            $variantProfile->snacks_per_day = $column['snacks_per_day'];
            $variantProfile->save();

            $report->created('plan_variant_profile');

            foreach ($durations as $durationId) {
                $assignment = new PlanVariantDuration;
                $assignment->organisation_id = $organisationId;
                $assignment->catalogue_item_variant_id = (string) $variant->getKey();
                $assignment->plan_duration_id = $durationId;
                $assignment->discount_percent = null;
                $assignment->is_available = true;
                $assignment->save();

                $report->created('plan_variant_duration');
            }

            $this->writePlaceholderPrice($item, $variant, $planList, $organisationId, $report);
        }
    }

    private function writePlaceholderPrice(
        CatalogueItem $item,
        CatalogueItemVariant $variant,
        ?PriceList $planList,
        string $organisationId,
        ImportReport $report,
    ): void {
        if (! $planList instanceof PriceList) {
            return;
        }

        $sourceRef = SourceManifest::PLANS.'#'.$item->slug.'/'.$variant->code;

        $exists = PriceListItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', $this->sourceSystem)
            ->where('source_ref', $sourceRef)
            ->exists();

        if ($exists) {
            $report->skipped('price_list_item');

            return;
        }

        $entry = new PriceListItem;
        $entry->organisation_id = $organisationId;
        $entry->price_list_id = (string) $planList->getKey();
        $entry->catalogue_item_id = (string) $item->getKey();
        $entry->catalogue_item_variant_id = (string) $variant->getKey();
        $entry->unit_amount_minor = null;
        $entry->price_status = PriceStatus::Placeholder;
        $entry->effective_from = now()->startOfDay();
        $entry->source_system = $this->sourceSystem;
        $entry->source_ref = $sourceRef;
        $entry->seeded_at = now();
        $entry->save();

        $report->created('price_list_item');
    }
}
