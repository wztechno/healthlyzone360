<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Recipes\Enums\AllergenDerivation;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeCompleteness;
use Healthy360\Recipes\Enums\RecipeConfidentiality;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Illuminate\Support\Str;

/**
 * The fifteen cooking sauces (SC-01..15) and fourteen salad dressings
 * (DR-01..14), imported as **indicative** draft recipes.
 *
 * **They get no lines, and that is the honest reading.** The workbook's
 * "Typical ingredients" column is prose — "Garam masala, onion, garlic, ginger,
 * tomato, yogurt, oil" — and the sheet says of itself that these are "typical
 * Lebanese/Mediterranean formulations — validate against the kitchen's actual
 * recipes before use". Splitting that on commas and calling the result a
 * formulation would manufacture quantities nobody stated, from a list the
 * source explicitly disclaims. So the prose is kept verbatim in `notes`, where
 * a chef writing the real version can read it, and `completeness` stays
 * `indicative`, which is the word this schema already has for exactly this.
 *
 * **What they do carry is the allergen declaration**, and that is the reason
 * they are imported at all. The sheets name a class and the ingredient that
 * triggers it — "Sesame — tahini", "Milk — cream / yogurt" — which is a real
 * food-safety statement made by a human. It becomes `recipe_version_allergens`
 * rows with `derivation = declared` and `source_ingredient_id` pointing at the
 * named ingredient wherever the curated dictionary resolves it. A declared row
 * is never weakened by a later recomputation (K1.2), so the statement survives
 * whatever the derivation does.
 *
 * **A sauce tagged "None" is recorded as a finding, not as silence.** The
 * workbook's own key lists "None — Not a regulated allergen", so the cell is a
 * claim; it is reported so a reviewer can confirm it rather than assumed
 * because the row was empty.
 */
final readonly class IndicativeRecipeWriter
{
    public function __construct(
        private DesignationResolver $resolver,
        private string $sourceSystem,
    ) {}

    /**
     * @param  array{sauces: list<array<string, mixed>>, dressings: list<array<string, mixed>>, findings: list<array{code: string, detail: string}>}  $parsed
     */
    public function write(array $parsed, string $organisationId, ImportReport $report): void
    {
        $report->findings($parsed['findings'], SourceManifest::INGREDIENTS);

        foreach ([['Cooking sauce', $parsed['sauces']], ['Salad dressing', $parsed['dressings']]] as [$kind, $rows]) {
            foreach ($rows as $row) {
                $this->writeOne($row, $kind, $organisationId, $report);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function writeOne(array $row, string $kind, string $organisationId, ImportReport $report): void
    {
        /** @var string $sourceId */
        $sourceId = $row['source_ref'];
        /** @var string $name */
        $name = $row['name'];
        $sourceRef = SourceManifest::INGREDIENTS.'#'.$sourceId;

        $existing = Recipe::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', $this->sourceSystem)
            ->where('source_ref', $sourceRef)
            ->first();

        if ($existing instanceof Recipe) {
            $report->skipped('recipe');
            $report->skipped('recipe_version');

            return;
        }

        $report->created('recipe');
        $report->created('recipe_version');

        /** @var list<string> $classes */
        $classes = $row['allergen_classes'];
        /** @var list<array{class: string, ingredient: string}> $sources */
        $sources = $row['allergen_sources'];

        if ($classes === []) {
            $report->allergenReviewItem(
                'declared_no_regulated_allergen',
                sprintf('%s "%s" is tagged "None" by the source. Confirm before any label reaches a diner.', $sourceId, $name),
                $sourceRef,
            );
        }

        $recipe = new Recipe;
        $recipe->organisation_id = $organisationId;
        $recipe->branch_id = null;
        $recipe->slug = Str::slug($sourceId.' '.$name);
        $recipe->name_en = $name;
        $recipe->name_ar = $name;
        $recipe->recipe_category = $kind === 'Cooking sauce' ? 'cooking_sauce' : 'salad_dressing';
        $recipe->source_kind = 'indicative_formulation';

        // Internal, not confidential: these carry no cost and no measured
        // formulation, and the same sheet is what the allergen key comes from.
        $recipe->confidentiality = RecipeConfidentiality::Internal;
        $recipe->status = RecipeStatus::Active;
        $recipe->source_system = $this->sourceSystem;
        $recipe->source_ref = $sourceRef;
        $recipe->seeded_at = now();
        $recipe->lock_version = 0;
        $recipe->save();

        $version = new RecipeVersion;
        $version->recipe_id = (string) $recipe->getKey();
        $version->organisation_id = $organisationId;
        $version->version_number = 1;
        $version->status = RecipeVersionStatus::Draft;
        $version->completeness = RecipeCompleteness::Indicative;
        $version->waste_coefficient_percent = '0';
        $version->derivation_state = DerivationState::Stale;
        $version->notes = $this->notes($row, $kind);
        $version->source_system = $this->sourceSystem;
        $version->source_ref = $sourceRef;
        $version->seeded_at = now();
        $version->lock_version = 0;
        $version->save();

        $this->writeDeclaredLabel($version, $classes, $sources, $organisationId, $sourceRef, $report);
    }

    /**
     * @param  list<string>  $classes
     * @param  list<array{class: string, ingredient: string}>  $sources
     */
    private function writeDeclaredLabel(
        RecipeVersion $version,
        array $classes,
        array $sources,
        string $organisationId,
        string $sourceRef,
        ImportReport $report,
    ): void {
        $written = [];

        foreach ($classes as $verbatim) {
            $resolved = AllergenClassMap::resolve($verbatim);

            if ($resolved === null) {
                if (! AllergenClassMap::isExplicitNone($verbatim)) {
                    $report->failed('recipe_version_allergen');
                    $report->allergenReviewItem(
                        'allergen_class_unmapped',
                        sprintf('%s names the allergen class "%s", which is not one of the fourteen canonical codes. No row was written.', $sourceRef, $verbatim),
                        $sourceRef,
                    );
                }

                continue;
            }

            // UNIQUE (recipe_version_id, allergen_code): a sheet naming the
            // same class twice under two markers gets one row, and the note
            // records both readings.
            if (isset($written[$resolved['code']])) {
                continue;
            }

            $written[$resolved['code']] = true;

            $sourceIngredient = $this->sourceIngredientFor($resolved['code'], $verbatim, $sources, $sourceRef, $report);

            $rowModel = new RecipeVersionAllergen;
            $rowModel->recipe_version_id = (string) $version->getKey();
            $rowModel->organisation_id = $organisationId;
            $rowModel->allergen_code = $resolved['code'];

            // `contains`, not `may_contain`: the source states the class as a
            // property of the formulation, not as a cross-contamination
            // warning. Downgrading a declaration nobody hedged would be the one
            // direction this system never moves an allergen in.
            $rowModel->containment = AllergenContainment::Contains;
            $rowModel->derivation = AllergenDerivation::Declared;
            $rowModel->source_ingredient_id = $sourceIngredient;
            $rowModel->source_note = mb_substr(sprintf(
                'Declared by %s as "%s". Market scope: %s. Verification: %s.',
                $sourceRef,
                $resolved['verbatim'],
                $resolved['market_scope']->value,
                $resolved['verification_status']->value,
            ), 0, 255);
            $rowModel->save();

            $report->created('recipe_version_allergen');
        }
    }

    /**
     * The ingredient the sheet blames for a class, resolved through the same
     * curated dictionary everything else uses.
     *
     * A source the dictionary does not cover leaves the column NULL and is
     * reported. The declaration still stands — the class is the safety-critical
     * half — but "why does this say sesame" becomes unanswerable from the row,
     * and that is worth a line in the report.
     *
     * @param  list<array{class: string, ingredient: string}>  $sources
     */
    private function sourceIngredientFor(string $code, string $verbatim, array $sources, string $sourceRef, ImportReport $report): ?string
    {
        foreach ($sources as $source) {
            $resolved = AllergenClassMap::resolve($source['class']);

            if ($resolved === null || $resolved['code'] !== $code) {
                continue;
            }

            // "cream / yogurt" names two; the first is the one the row can
            // point at, and the note keeps the sheet's whole phrase.
            foreach (preg_split('#\s*/\s*#', $source['ingredient']) ?: [] as $candidate) {
                $candidate = trim(preg_replace('/\(.*?\)/u', '', $candidate) ?? $candidate);

                if ($candidate === '') {
                    continue;
                }

                $ingredientId = $this->resolver->resolve($candidate);

                if ($ingredientId !== null) {
                    return $ingredientId;
                }

                $report->unresolvedDesignation(
                    $candidate,
                    $sourceRef.' (allergen source for '.$verbatim.')',
                    'the declared allergen row is written without a source ingredient',
                );
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function notes(array $row, string $kind): string
    {
        /** @var list<string> $typical */
        $typical = $row['typical_ingredients'];
        /** @var string|null $sheetNote */
        $sheetNote = $row['notes'] ?? null;

        $parts = [
            $kind.' imported from '.SourceManifest::INGREDIENTS.'.',
            'Typical ingredients as the source writes them: '.($typical === [] ? 'none listed' : implode(', ', $typical)).'.',
            'The source describes these as typical formulations to be validated against the kitchen\'s actual recipes, '
            .'so they are recorded here as prose rather than turned into recipe lines with quantities nobody stated.',
        ];

        if (is_string($sheetNote) && trim($sheetNote) !== '') {
            $parts[] = 'Source note: '.trim($sheetNote);
        }

        return implode(' ', $parts);
    }
}
