<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use RuntimeException;

/**
 * The kitchen's own ingredient rows — the raw materials its technical sheets
 * name and the 213-row platform library does not carry.
 *
 * Every one of them comes from the curated dictionary and none from the
 * workbook directly. That is the whole safety property: the importer cannot
 * invent an ingredient, because the only list it can create from is one a human
 * wrote. A designation that is neither in the library nor in the dictionary
 * fails its line and is reported — it does not quietly become row 214.
 *
 * **Unverified, and unmapped.** Each row lands `verification_status =
 * unverified` with **no allergen mapping at all**, because the technical sheets
 * record none. That is not an oversight the importer papers over; it is the
 * reason the allergen-review report exists, and the reason every imported
 * version stays a draft. `RecipeVersionService::publish()` refuses a
 * formulation whose ingredients have neither a mapping nor a `verified` status,
 * so the gap is structural rather than a note somebody has to remember.
 *
 * **Aliases carry the workbook's own spellings.** "Cripsy Spice" becomes an
 * alias of Crispy Spice rather than disappearing into the dictionary, so a
 * future import, a supplier feed or a human searching for what the sheet
 * actually said still lands on the right row.
 */
final readonly class IngredientWriter
{
    public function __construct(
        private DesignationDictionary $dictionary,
        private DesignationResolver $resolver,
        private string $sourceSystem,
    ) {}

    /**
     * Create the dictionary's tenant ingredients and the aliases that point at
     * them, then rebuild the resolver so the rest of the run can see them.
     */
    public function write(string $organisationId, ImportReport $report): void
    {
        $categories = $this->categoryIds();
        $units = $this->unitIds();
        $now = now();

        foreach ($this->dictionary->tenantIngredients() as $definition) {
            $sourceRef = 'kitchen-workbook-aliases.json#'.$definition['slug'];

            $existing = Ingredient::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('source_system', $this->sourceSystem)
                ->where('source_ref', $sourceRef)
                ->first();

            if ($existing instanceof Ingredient) {
                $report->skipped('ingredient');

                continue;
            }

            $report->created('ingredient');

            $ingredient = new Ingredient;
            $ingredient->organisation_id = $organisationId;
            $ingredient->slug = $definition['slug'];
            $ingredient->name_en = $definition['name_en'];

            // The workbook is English-only. A machine translation of a food
            // name that ends up on an allergen label is not an improvement on
            // an honest fallback (the platform library takes the same view).
            $ingredient->name_ar = $definition['name_en'];
            $ingredient->ingredient_category_id = $categories[$definition['category_code'] ?? ''] ?? null;
            $ingredient->ingredient_subcategory_id = $categories[$definition['subcategory_code'] ?? ''] ?? null;
            $ingredient->default_unit_id = $units[$definition['default_unit']] ?? $units['kg'];
            $ingredient->availability_tier = null;
            $ingredient->status = IngredientStatus::Active;
            $ingredient->verification_status = IngredientVerificationStatus::Unverified;
            $ingredient->notes = $definition['note'];
            $ingredient->source_system = $this->sourceSystem;
            $ingredient->source_ref = $sourceRef;
            $ingredient->seeded_at = $now;
            $ingredient->save();
        }

        $this->resolver->refresh();
        $this->writeAliases($organisationId, $report);
        $this->resolver->refresh();

        $this->reportGaps($report);
    }

    /**
     * Every curated alias whose target is one of this organisation's own rows
     * becomes a real `ingredient_aliases` row.
     *
     * Aliases onto **platform library** rows are deliberately not written: a
     * tenant may not edit the library, and "Onion White" is the workbook's word
     * for the platform's "Onions", not a fact about the platform's row. The
     * dictionary keeps resolving it either way.
     */
    private function writeAliases(string $organisationId, ImportReport $report): void
    {
        foreach ($this->dictionary->aliases() as $normalised => $target) {
            $ingredientId = $this->resolver->byName($target);

            if ($ingredientId === null) {
                continue;
            }

            $owner = Ingredient::withoutTenancy()->whereKey($ingredientId)->value('organisation_id');

            if ($owner !== $organisationId) {
                continue;
            }

            $exists = IngredientAlias::query()
                ->where('ingredient_id', $ingredientId)
                ->where('alias_normalised', $normalised)
                ->exists();

            if ($exists) {
                $report->skipped('ingredient_alias');

                continue;
            }

            $report->created('ingredient_alias');

            $alias = new IngredientAlias;
            $alias->ingredient_id = $ingredientId;
            $alias->alias = $normalised;
            $alias->source_system = $this->sourceSystem;
            $alias->source_ref = 'kitchen-workbook-aliases.json#alias';
            $alias->save();
        }
    }

    private function reportGaps(ImportReport $report): void
    {
        $report->knownGap(
            'ingredient_availability_tier_null',
            sprintf(
                'All %d imported tenant ingredients have availability_tier NULL. The workbook promises a '
                .'Core/Common/Specialty-imported flag in its introduction and no sheet carries the column.',
                count($this->dictionary->tenantIngredients()),
            ),
        );

        $report->knownGap(
            'ingredient_arabic_name_fallback',
            'Every imported tenant ingredient uses its English name as its Arabic name. The workbook is '
            .'English-only and a machine translation on an allergen label is worse than an obvious fallback.',
        );

        foreach ($this->dictionary->intermediatesWithoutSheets() as $intermediate) {
            $report->knownGap(
                'intermediate_without_technical_sheet',
                sprintf(
                    '"%s" is consumed by at least one technical sheet and produced by none. It exists as an '
                    .'ingredient so the lines resolve; no recipe is fabricated for it and it has no outputs row.',
                    $intermediate['name_en'],
                ),
            );
        }
    }

    /**
     * @return array<string, string> category code → id
     */
    private function categoryIds(): array
    {
        /** @var array<string, string> */
        return IngredientCategory::withoutTenancy()->whereNull('organisation_id')->pluck('id', 'code')->all();
    }

    /**
     * @return array<string, string> unit code → id
     */
    private function unitIds(): array
    {
        /** @var array<string, string> $units */
        $units = MeasurementUnit::query()->pluck('id', 'code')->all();

        if (! isset($units['kg'])) {
            throw new RuntimeException('The measurement units must be seeded before an import.');
        }

        return $units;
    }
}
