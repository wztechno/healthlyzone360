<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Services\IngredientDerivationInvalidator;
use Healthy360\Ingredients\Services\IngredientMutationLock;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Illuminate\Support\Facades\DB;

/**
 * A sub-recipe's allergens, written onto the ingredient it produces — the
 * allergen half of {@see RecipeOutputNutritionWriter}, with the same rules.
 *
 * An in-house sauce defines the ingredient it makes, so its frozen label is
 * written onto that ingredient's organisation layer as `recipe_derived` rows,
 * and every dish built on the sauce picks the allergens up through the
 * ordinary roll-up. Only a dish whose rows actually moved is invalidated, which
 * is what sends a dish whose published label changes to review.
 *
 * - **Published versions only, own-organisation outputs only**, as for
 *   nutrition: a draft must not relabel the dishes built on the live sauce, and
 *   a platform ingredient named as an output is every kitchen's row.
 * - **A manual row is kept.** A kitchen's own row for the same class (a
 *   shared-fryer `may_contain`) stays its own; it is raised to the derived
 *   containment when that is stronger, and never weakened or deleted.
 * - **Codes no longer derived lose their derived rows.** The last publication
 *   is the definition of the thing.
 * - **An empty label still claims the ingredient**
 *   (`allergens_derived_from_version_id`), so the publish gate reads the
 *   output as assessed rather than unassessed.
 *
 * ponytail: rows are written for market scope `all` only. The frozen label is
 * one row per class and keeps its scopes only in a note, so a `us_only` class
 * carries through as `all` — over-declared, never under. Carry scopes on the
 * label if a market ever needs the distinction.
 */
final readonly class RecipeOutputAllergenWriter
{
    public function __construct(
        private IngredientDerivationInvalidator $invalidator,
        private RecipeLabelWriter $labels,
    ) {}

    /**
     * Push one published version's frozen label onto everything it produces,
     * and return how many ingredients' rows actually moved.
     *
     * @param  bool  $scheduleDependants  as for nutrition: true from publish and release, false
     *                                    from `RecomputeRecipeDerivations`, whose own `propagate()`
     *                                    walks the same edge with the visited set and depth cap
     */
    public function write(RecipeVersion $version, bool $scheduleDependants = true): int
    {
        if ($version->status !== RecipeVersionStatus::Published) {
            return 0;
        }

        return $this->apply($version, $this->labels->snapshot($version), claim: true, scheduleDependants: $scheduleDependants);
    }

    /**
     * Give back the rows and the claim this version holds, when it stops being
     * published. A raised manual row stays raised: it is the kitchen's row.
     */
    public function clear(RecipeVersion $version): int
    {
        return $this->apply($version, [], claim: false, scheduleDependants: true);
    }

    /**
     * @param  array<string, AllergenContainment>  $label
     */
    private function apply(RecipeVersion $version, array $label, bool $claim, bool $scheduleDependants): int
    {
        $versionId = (string) $version->getKey();
        $moved = 0;

        foreach ($this->outputIngredientsOf($version) as $ingredient) {
            $changed = DB::transaction(function () use ($ingredient, $label, $claim, $versionId): bool {
                // The mapping editor's lock, so a kitchen saving its own rows
                // and a publication writing derived ones never interleave.
                IngredientMutationLock::acquire((string) $ingredient->getKey());

                $changed = $this->sync($ingredient, $label, $claim, $versionId);

                // Read under the lock. Releasing gives back only this
                // version's claim; one another version has since taken is
                // that version's to answer for.
                $current = Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->value('allergens_derived_from_version_id');
                $owner = $claim ? $versionId : ($current === $versionId ? null : $current);

                if ($owner !== $current) {
                    Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->update([
                        'allergens_derived_from_version_id' => $owner,
                        'updated_at' => now(),
                    ]);
                }

                return $changed;
            });

            if (! $changed) {
                continue;
            }

            $moved++;

            if ($scheduleDependants) {
                $this->invalidator->invalidate($ingredient, $ingredient->organisation_id);
            }
        }

        return $moved;
    }

    /**
     * Bring one ingredient's organisation-layer rows into line with the label,
     * and say whether any containment a dish could read actually moved.
     *
     * @param  array<string, AllergenContainment>  $label
     */
    private function sync(Ingredient $ingredient, array $label, bool $claim, string $versionId): bool
    {
        $rows = IngredientAllergen::withoutTenancy()
            ->where('ingredient_id', $ingredient->getKey())
            ->where('organisation_id', $ingredient->organisation_id)
            ->where('market_scope', AllergenMarketScope::All->value)
            ->get()
            ->keyBy('allergen_code');

        $changed = false;

        foreach ($rows as $code => $row) {
            if ($row->source !== AllergenMappingSource::RecipeDerived) {
                continue;
            }

            // Claiming: whatever the label no longer says goes, whoever wrote
            // it. Releasing: only what this version wrote.
            $keep = $claim ? isset($label[$code]) : $row->derived_from_version_id !== $versionId;

            if (! $keep) {
                $row->delete();
                $rows->forget($code);
                $changed = true;
            }
        }

        foreach ($label as $code => $containment) {
            $row = $rows->get($code);

            if ($row === null) {
                $row = new IngredientAllergen;
                $row->ingredient_id = (string) $ingredient->getKey();
                $row->organisation_id = $ingredient->organisation_id;
                $row->allergen_code = $code;
                $row->market_scope = AllergenMarketScope::All;
                $row->containment = $containment;
                $row->source = AllergenMappingSource::RecipeDerived;
                $row->verification_status = AllergenVerificationStatus::Verified;
                $row->derived_from_version_id = $versionId;
                $row->save();
                $changed = true;

                continue;
            }

            if ($row->source === AllergenMappingSource::RecipeDerived) {
                $row->containment = $containment;
                $row->derived_from_version_id = $versionId;
            } elseif ($containment->strength() > $row->containment->strength()) {
                // The manual-row rule: raised, never weakened or deleted.
                $row->containment = $containment;
            }

            $changed = $changed || $row->isDirty('containment');

            if ($row->isDirty()) {
                $row->save();
            }
        }

        return $changed;
    }

    /**
     * The ingredients this version produces that its own organisation owns —
     * the nutrition writer's rule, for the nutrition writer's reason.
     *
     * @return list<Ingredient>
     */
    private function outputIngredientsOf(RecipeVersion $version): array
    {
        $ingredientIds = RecipeVersionOutput::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->pluck('ingredient_id')
            ->all();

        if ($ingredientIds === []) {
            return [];
        }

        return array_values(Ingredient::withoutTenancy()
            ->whereKey($ingredientIds)
            ->where('organisation_id', $version->organisation_id)
            ->get()
            ->all());
    }
}
