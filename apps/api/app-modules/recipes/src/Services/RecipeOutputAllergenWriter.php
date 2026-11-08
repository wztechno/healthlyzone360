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
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Illuminate\Support\Facades\DB;

/**
 * A sub-recipe's allergens, written onto the ingredient it produces — the
 * allergen half of {@see RecipeOutputNutritionWriter}.
 *
 * An in-house sauce defines the ingredient it makes, so its frozen label is
 * written onto that ingredient's organisation layer as `recipe_derived` rows,
 * and every dish built on the sauce picks the allergens up through the
 * ordinary roll-up. Only a dish whose rows actually moved is invalidated, which
 * is what sends a dish whose published label changes to review.
 *
 * - **Every live producer counts.** Nothing stops two recipes outputting the
 *   same ingredient, so an output carries, per class, the strongest containment
 *   across every `published` and `review_required` version that produces it. A
 *   version in review counts with the label it was published with
 *   (`previous_label`) as well as the recomputed one: nobody has accepted the
 *   loss of a class yet.
 * - **Never under-declared before review.** A recompute only strengthens
 *   ({@see strengthen()}); removing or weakening a class happens only when a
 *   person publishes or releases ({@see write()}), or a producer stops being
 *   live ({@see clear()}).
 * - **Own-organisation outputs only**, as for nutrition: a platform ingredient
 *   named as an output is every kitchen's row, and carries nothing.
 * - **A manual row is kept.** A kitchen's own row for the same class stays its
 *   own; it is raised to the derived containment when that is stronger (and the
 *   evidence says so), and never weakened or deleted.
 * - **An empty label still claims the ingredient**
 *   (`allergens_derived_from_version_id`), so the publish gate reads the output
 *   as assessed rather than unassessed.
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
     * After a publication or a release: bring everything this published version
     * produces exactly into line with its live producers, removals included, and
     * return how many ingredients' rows moved.
     *
     * @param  bool  $scheduleDependants  true from publish and release; false only from the
     *                                    dry run, which schedules nothing
     */
    public function write(RecipeVersion $version, bool $scheduleDependants = true): int
    {
        if ($version->status !== RecipeVersionStatus::Published) {
            return 0;
        }

        return $this->apply($version, strengthenOnly: false, scheduleDependants: $scheduleDependants);
    }

    /**
     * From `RecomputeRecipeDerivations`: carry a recomputed label onto the
     * outputs, strengthening only. A recompute is not a review, so a class it
     * drops stays carried until a person publishes or releases; a class it adds
     * carries at once, even while the version is in review.
     *
     * Never schedules: the job's own `propagate()` walks the same output → line
     * edge with its visited set and depth cap.
     */
    public function strengthen(RecipeVersion $version): int
    {
        if (! in_array($version->status, [RecipeVersionStatus::Published, RecipeVersionStatus::ReviewRequired], true)) {
            return 0;
        }

        return $this->apply($version, strengthenOnly: true, scheduleDependants: false);
    }

    /**
     * After a version stops being live: re-derive everything it produced from
     * the producers that remain — nothing, if none do.
     */
    public function clear(RecipeVersion $version): int
    {
        return $this->apply($version, strengthenOnly: false, scheduleDependants: true);
    }

    private function apply(RecipeVersion $version, bool $strengthenOnly, bool $scheduleDependants): int
    {
        $moved = 0;

        foreach ($this->outputIngredientsOf($version) as $ingredient) {
            $changed = DB::transaction(function () use ($ingredient, $version, $strengthenOnly): bool {
                // The mapping editor's lock, so a kitchen saving its own rows
                // and a publication writing derived ones never interleave.
                IngredientMutationLock::acquire((string) $ingredient->getKey());

                $producers = $this->producersOf($ingredient);
                $current = Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->value('allergens_derived_from_version_id');
                $claim = $this->claim($producers, is_string($current) ? $current : null, (string) $version->getKey());

                // A version quarantined before `previous_label` existed has no
                // floor: its published label is unknown, so nothing it may have
                // dropped can be removed until somebody releases it. Its outputs
                // are only ever strengthened meanwhile, and the carry command
                // lists it.
                $unfloored = array_filter($producers, static fn (RecipeVersion $producer): bool => self::unfloored($producer));

                $changed = $this->sync($ingredient, $this->labelOf($producers), $claim, $strengthenOnly || $unfloored !== []);

                if ($claim !== $current) {
                    Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->update([
                        'allergens_derived_from_version_id' => $claim,
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
     * @param  array<string, array{containment: AllergenContainment, version: RecipeVersion}>  $label
     */
    private function sync(Ingredient $ingredient, array $label, ?string $claim, bool $strengthenOnly): bool
    {
        $rows = IngredientAllergen::withoutTenancy()
            ->where('ingredient_id', $ingredient->getKey())
            ->where('organisation_id', $ingredient->organisation_id)
            ->where('market_scope', AllergenMarketScope::All->value)
            ->get()
            ->keyBy('allergen_code');

        $changed = false;

        if (! $strengthenOnly) {
            foreach ($rows as $code => $row) {
                if ($row->source === AllergenMappingSource::RecipeDerived && ! isset($label[$code])) {
                    $row->delete();
                    $rows->forget($code);
                    $changed = true;
                }
            }
        }

        foreach ($label as $code => ['containment' => $containment, 'version' => $source]) {
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
                $row->derived_from_version_id = $claim;
                $row->save();
                $changed = true;

                continue;
            }

            $stronger = $containment->strength() > $row->containment->strength();

            if ($row->source === AllergenMappingSource::RecipeDerived) {
                if ($stronger || ! $strengthenOnly) {
                    $row->containment = $containment;
                }

                $row->derived_from_version_id = $claim;
            } elseif ($stronger) {
                // The manual-row rule: raised, never weakened or deleted — and
                // the evidence says where the stronger statement came from.
                $row->containment = $containment;
                $row->evidence = ($row->evidence === null || $row->evidence === '' ? '' : $row->evidence.' — ')
                    .sprintf('Raised from recipe %s v%d.', $this->recipeName($source), $source->version_number);
            }

            $changed = $changed || $row->isDirty('containment');

            if ($row->isDirty()) {
                $row->save();
            }
        }

        return $changed;
    }

    /**
     * Every live version of this organisation that produces the ingredient.
     *
     * @return list<RecipeVersion>
     */
    private function producersOf(Ingredient $ingredient): array
    {
        return array_values(RecipeVersion::withoutTenancy()
            ->where('organisation_id', $ingredient->organisation_id)
            ->whereIn('status', [RecipeVersionStatus::Published->value, RecipeVersionStatus::ReviewRequired->value])
            ->whereIn('id', RecipeVersionOutput::withoutTenancy()
                ->where('ingredient_id', $ingredient->getKey())
                ->select('recipe_version_id'))
            ->orderBy('id')
            ->get()
            ->all());
    }

    /**
     * The strongest containment per class across the producers, with the
     * version that stated it. A version in review counts with its published
     * label too: a class it lost has not been accepted as lost.
     *
     * @param  list<RecipeVersion>  $producers
     * @return array<string, array{containment: AllergenContainment, version: RecipeVersion}>
     */
    private function labelOf(array $producers): array
    {
        $label = [];

        foreach ($producers as $producer) {
            $statements = $this->labels->snapshot($producer);

            if ($producer->status === RecipeVersionStatus::ReviewRequired) {
                foreach ($producer->previous_label ?? [] as $code => $value) {
                    $code = (string) $code;
                    $previous = AllergenContainment::tryFrom(is_string($value) ? $value : '');
                    $recomputed = $statements[$code] ?? null;

                    if ($previous !== null && ($recomputed === null || $previous->strength() > $recomputed->strength())) {
                        $statements[$code] = $previous;
                    }
                }
            }

            foreach ($statements as $code => $containment) {
                $incumbent = $label[$code] ?? null;

                if ($incumbent === null || $containment->strength() > $incumbent['containment']->strength()) {
                    $label[$code] = ['containment' => $containment, 'version' => $producer];
                }
            }
        }

        ksort($label);

        return $label;
    }

    /**
     * Whose claim the ingredient carries: the current holder while it is still
     * live, else the version that triggered this write, else any live producer.
     *
     * @param  list<RecipeVersion>  $producers
     */
    private function claim(array $producers, ?string $current, string $trigger): ?string
    {
        $ids = array_map(static fn (RecipeVersion $producer): string => (string) $producer->getKey(), $producers);

        foreach ([$current, $trigger] as $candidate) {
            if ($candidate !== null && in_array($candidate, $ids, true)) {
                return $candidate;
            }
        }

        return $ids[0] ?? null;
    }

    /**
     * In review with no recorded published label — a quarantine older than the
     * `previous_label` column.
     */
    public static function unfloored(RecipeVersion $version): bool
    {
        return $version->status === RecipeVersionStatus::ReviewRequired && $version->previous_label === null;
    }

    private function recipeName(RecipeVersion $version): string
    {
        $name = Recipe::withoutTenancy()->whereKey($version->recipe_id)->value('name_en');

        return is_string($name) ? $name : (string) $version->recipe_id;
    }

    /**
     * The ingredients this version produces that its own organisation owns —
     * the nutrition writer's rule, for the nutrition writer's reason. The
     * console command lists the platform outputs this skips.
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
