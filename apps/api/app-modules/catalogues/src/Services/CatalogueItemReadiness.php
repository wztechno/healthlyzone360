<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Contracts\ConfirmedPriceRegistry;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;

/**
 * Why a catalogue item is not ready to be published — as a list, computed, and
 * never stored.
 *
 * The gates were evaluated inside `PublishCatalogueItem` from K1.4 through
 * K1.6, which meant the only way to discover them was to attempt a publication
 * and read the refusal. A review queue cannot work that way: a screen showing
 * "four of these thirty listings are ready" cannot publish thirty listings to
 * find out. So K1.8 lifts the gates out — **the same gates**, in the same
 * order, not a second opinion about them. `PublishCatalogueItem` now asks this
 * service and throws from what it returns, and `GET …/readiness` asks this
 * service and serialises what it returns.
 *
 * Nothing about *what* blocks a publication changed here. The rules, in the
 * order they are reported:
 *
 * - **State.** Only a draft publishes. A quarantined item (`review_required`)
 *   is blocked structurally — that is what the state is for (§4.7) — and a
 *   published or retired one is not a candidate.
 * - **Both languages.** An item whose Arabic name is empty is untranslated, and
 *   an untranslated listing reaching an Arabic-speaking customer as English is
 *   the failure §4.18 exists to prevent.
 * - **Something to buy.** A product with no active variant is a name with no
 *   pack behind it, and a price has nothing to attach to.
 * - **An allergen basis.** A meal must either link a recipe with a published
 *   version, or list its own ingredients. Silence is not a statement of
 *   absence.
 * - **Quarantine propagates.** A linked recipe carrying a live
 *   `review_required` version blocks publication even if a good published
 *   version exists beside it. The answer to "may we sell the dish while
 *   somebody works out whether the burghul contains gluten" is no.
 * - **Plans only** (K1.6): terms, a matrix, a run, and a confirmed price on
 *   every active configuration.
 *
 * Each reason is `{code, detail, context}`: a stable machine key, a sentence a
 * human can act on, and whatever identifies the offending rows. The context is
 * a nested object rather than sibling keys so that adding a reason with new
 * structure never changes the shape of a reason.
 */
final readonly class CatalogueItemReadiness
{
    public function __construct(
        private DerivedAllergenService $allergens,
        private ConfirmedPriceRegistry $prices,
    ) {}

    /**
     * Every reason this item cannot be published.
     *
     * Every check is evaluated even when an earlier one has already failed, for
     * the reason the whole apparatus exists: a plan missing its profile *and*
     * its prices should learn both facts in one attempt rather than two.
     *
     * @return list<array{code: string, detail: string, context: array<string, mixed>}>
     */
    public function reasons(CatalogueItem $item): array
    {
        $reasons = [];

        if ($item->status === CatalogueItemStatus::ReviewRequired) {
            $reasons[] = [
                'code' => 'item_quarantined',
                'detail' => 'This listing is quarantined for review. A quarantine is an unresolved food-safety question about what it sells, and it blocks publication structurally until a human settles it.',
                'context' => ['review_reason' => $item->review_reason],
            ];
        } elseif ($item->status !== CatalogueItemStatus::Draft) {
            $reasons[] = [
                'code' => 'item_not_a_draft',
                'detail' => 'Only a draft listing can be published. A published listing is already on sale, and a retired one is withdrawn for good.',
                'context' => ['status' => $item->status->value],
            ];
        }

        $untranslated = [];

        if (trim($item->name_en) === '') {
            $untranslated[] = 'name_en';
        }

        if (trim($item->name_ar) === '') {
            $untranslated[] = 'name_ar';
        }

        if ($untranslated !== []) {
            $reasons[] = [
                'code' => 'translation_incomplete',
                'detail' => 'Both languages are required before a listing goes on sale. An untranslated listing reaching an Arabic-speaking customer as English is exactly what the bilingual rule exists to prevent.',
                'context' => ['fields' => $untranslated],
            ];
        }

        if ($item->item_type === CatalogueItemType::Product && ! $this->hasActiveVariant($item)) {
            $reasons[] = [
                'code' => 'no_active_variant',
                'detail' => 'A product with no active pack is a name with nothing behind it, and a price has nothing to attach to.',
                'context' => [],
            ];
        }

        if ($item->item_type === CatalogueItemType::Meal && ! $this->hasAllergenBasis($item)) {
            $reasons[] = [
                'code' => 'no_allergen_basis',
                'detail' => 'A meal must either link a recipe with a published version or list its own ingredients. An item that can answer neither cannot say what is in it, and silence is not a statement of absence.',
                'context' => [],
            ];
        }

        $quarantined = $this->quarantinedVersionIds($item);

        if ($quarantined !== []) {
            $reasons[] = [
                'code' => 'linked_recipe_quarantined',
                'detail' => 'The linked recipe carries a version under review. A quarantine is an unresolved food-safety contradiction on that formulation, and it travels to everything selling it.',
                'context' => ['recipe_id' => $item->recipe_id, 'recipe_version_ids' => $quarantined],
            ];
        }

        if ($item->item_type === CatalogueItemType::SubscriptionPlan) {
            $reasons = [...$reasons, ...$this->planReasons($item)];
        }

        return $reasons;
    }

    /**
     * The plan-only half of the gate (K1.6).
     *
     * @return list<array{code: string, detail: string, context: array<string, mixed>}>
     */
    private function planReasons(CatalogueItem $item): array
    {
        $reasons = [];

        if (! SubscriptionPlanProfile::withoutTenancy()->whereKey($item->getKey())->exists()) {
            $reasons[] = [
                'code' => 'plan_profile_missing',
                'detail' => 'Nobody has written this plan\'s terms: how it is sold, on what basis it is priced, or how late a subscriber may change a delivery. A listing that answers none of those is not a listing.',
                'context' => [],
            ];
        }

        /** @var array<string, string> $activeConfigurations identifier → code */
        $activeConfigurations = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('variant_type', VariantType::PlanConfiguration->value)
            ->where('status', VariantStatus::Active->value)
            ->orderBy('code')
            ->pluck('code', 'id')
            ->all();

        if ($activeConfigurations === []) {
            // Nothing further can be evaluated honestly: durations and prices
            // are both questions *about* configurations, and reporting "no
            // durations" beside "no configurations" would be two ways of saying
            // the same missing thing.
            return [...$reasons, [
                'code' => 'no_active_plan_configuration',
                'detail' => 'A plan with no active configuration is a name with no matrix behind it — the plan-side twin of a product with no pack.',
                'context' => [],
            ]];
        }

        $variantIds = array_map(strval(...), array_keys($activeConfigurations));

        $hasDuration = PlanVariantDuration::withoutTenancy()
            ->whereIn('catalogue_item_variant_id', $variantIds)
            ->where('is_available', true)
            ->exists();

        if (! $hasDuration) {
            $reasons[] = [
                'code' => 'no_duration_assigned',
                'detail' => 'No configuration offers a duration a customer could buy. A plan is sold for a period, and the period is not implied.',
                'context' => [],
            ];
        }

        $priced = $this->prices->pricedVariantIds($item->organisation_id, $variantIds);
        $unpriced = array_values(array_diff($variantIds, $priced));

        if ($unpriced !== []) {
            $reasons[] = [
                'code' => 'plan_prices_incomplete',
                'detail' => 'Some active configurations carry no confirmed, standing price on an active tariff. A placeholder is a row that says "we have not priced this", and a plan page rendering one is the failure the placeholder design exists to prevent.',

                // The codes as well as the identifiers: a merchandiser reading
                // this refusal is looking at a matrix labelled by code, and a
                // list of UUIDs would send them back to the API to find out
                // which cells to price.
                'context' => [
                    'catalogue_item_variant_ids' => $unpriced,
                    'configurations' => array_map(
                        static fn (string $id): string => $activeConfigurations[$id],
                        $unpriced,
                    ),
                ],
            ];
        }

        return $reasons;
    }

    private function hasActiveVariant(CatalogueItem $item): bool
    {
        return CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('status', VariantStatus::Active->value)
            ->exists();
    }

    /**
     * A meal may answer "what is in this" two ways: a published recipe version
     * whose frozen label it inherits, or its own ingredient list. Either is
     * enough; neither is not.
     */
    private function hasAllergenBasis(CatalogueItem $item): bool
    {
        if ($this->allergens->publishedVersion($item) !== null) {
            return true;
        }

        return CatalogueItemIngredient::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->exists();
    }

    /**
     * Live quarantined versions of the linked recipe.
     *
     * Retired ones are excluded: a quarantine resolved by superseding the
     * version is resolved, and history must not block a publication forever.
     *
     * @return list<string>
     */
    private function quarantinedVersionIds(CatalogueItem $item): array
    {
        if ($item->recipe_id === null) {
            return [];
        }

        return array_values(RecipeVersion::withoutTenancy()
            ->where('recipe_id', $item->recipe_id)
            ->where('status', RecipeVersionStatus::ReviewRequired->value)
            ->orderBy('version_number')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());
    }
}
