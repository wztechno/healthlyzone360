<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Services\IngredientDerivationInvalidator;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionOutput;

/**
 * A sub-recipe's own nutrition, written onto the ingredient it produces.
 *
 * A version that outputs an ingredient — a pesto mix, a taouk preparation —
 * *defines* that ingredient. Nobody looks its facts up in a reference table,
 * because there is no such thing as the nutrition of "pesto mix" in general;
 * there is only what this kitchen's formulation works out to. So the figures
 * are derived here and stored on the row, which is what lets the next
 * formulation up — the mayonnaise built on the mix — weigh its line of it like
 * any other ingredient and reach a total at all.
 *
 * ## The basis is the child's finished mass
 *
 * `per100gSlim()` divides by `total_grams`, which is the version's stated mass
 * yield where it has one and Σ input grams otherwise. That is the right
 * denominator and the only defensible one: a parent line says "300 g of pesto
 * mix", and 300 g of the *finished* mix is what it gets. A per-100 g figure
 * computed on input mass where a yield was stated would quietly overstate
 * everything by the water the batch lost.
 *
 * ## Derived facts are read-only
 *
 * `IngredientCatalogueService::update()` refuses `nutrition_per_100g` and
 * `grams_per_unit` on a row this has claimed, and the refusal is the point
 * rather than a convenience. A figure typed over a derivation survives exactly
 * until the next recompute, so the edit looks accepted and then silently
 * disappears — and while it stands it disagrees with the recipe that defines
 * the thing, which is the worse half. The fix for a wrong number here is the
 * formulation, not the catalogue row.
 *
 * ## Published versions only
 *
 * A draft's outputs must never overwrite a published sibling's figures. A chef
 * halving the oil in draft 3 has not changed what the kitchen is currently
 * making, and if the draft's arithmetic reached the ingredient every parent
 * recipe would silently re-label itself against a formulation nobody has
 * approved. {@see write()} checks the version's status and does nothing
 * otherwise — the publish path calls it after the promotion, and the recompute
 * job calls it for whatever the version actually is.
 *
 * ## Null facts still take the link
 *
 * A child whose result is incomplete writes null onto its output *and* claims
 * it. Both halves matter: the null is the withholding rule reaching one hop
 * further — a parent built on an intermediate nobody could weigh must withhold
 * too, and it does, because the ingredient it reads now states nothing — and
 * the link is what keeps the row read-only, so nobody papers over the gap by
 * typing a number onto the ingredient instead of fixing the recipe.
 */
final readonly class RecipeOutputNutritionWriter
{
    public function __construct(
        private IngredientDerivationInvalidator $invalidator,
    ) {}

    /**
     * Push one published version's per-100 g figures onto everything it
     * produces, and return how many rows actually moved.
     *
     * @param  bool  $scheduleDependants  whether to mark the formulations built on these rows stale
     *                                    and queue their recompute. **One scheduler per hop.** The
     *                                    publish path says true, because publication deliberately
     *                                    dispatches nothing else and a parent recipe would
     *                                    otherwise go on totalling against the figures its
     *                                    component had yesterday. `RecomputeRecipeDerivations` says
     *                                    false, because its own `propagate()` walks the very same
     *                                    output → line edge a moment later, carrying a visited set
     *                                    and a depth cap that this path — a fresh dispatch at depth
     *                                    zero — has neither of. Two schedulers there would turn one
     *                                    mapping edit into the unbounded cascade that walk exists
     *                                    to bound.
     */
    public function write(RecipeVersion $version, RecipeNutritionResult $result, bool $scheduleDependants = true): int
    {
        if ($version->status !== RecipeVersionStatus::Published) {
            return 0;
        }

        $facts = $result->per100gSlim();

        return $this->apply($version, $facts, (string) $version->getKey(), $scheduleDependants);
    }

    /**
     * Give back everything a version claimed, when the version stops being
     * published.
     *
     * A withdrawn child withholds the parent, by the same rule that makes an
     * unweighable line withhold a whole label: the figures on the ingredient
     * were true of a formulation that is no longer live, and leaving them
     * standing would let a parent go on deriving a total from a recipe this
     * kitchen has retired. Only rows this version claimed are touched — an
     * ingredient some *other* version has since taken over is that version's
     * to answer for.
     */
    public function clear(RecipeVersion $version): int
    {
        return $this->apply($version, null, null, scheduleDependants: true);
    }

    /**
     * @param  array{basis: string, amounts: list<array{nutrient_id: string, unit: string, value: float}>}|null  $facts
     * @param  string|null  $versionId  the version to claim the rows for, or null to release the
     *                                  ones it already holds
     */
    private function apply(RecipeVersion $version, ?array $facts, ?string $versionId, bool $scheduleDependants): int
    {
        $written = 0;

        foreach ($this->outputIngredientsOf($version) as $ingredient) {
            // Releasing touches only what this version owns; claiming
            // overwrites whatever was there, because a published output is the
            // definition of the thing and the last publication is the current
            // one.
            if ($versionId === null && $ingredient->nutrition_derived_from_version_id !== (string) $version->getKey()) {
                continue;
            }

            $ingredient->nutrition_per_100g = $facts;
            $ingredient->nutrition_derived_from_version_id = $versionId;

            // The seeder's rule, for the seeder's reason and one more. Saving an
            // unchanged row would queue a recompute of every parent on every
            // republish, and two components that each produce what the other
            // consumes would then invalidate each other forever — the walk in
            // `RecomputeRecipeDerivations::propagate()` carries a visited set,
            // and this path, which reaches parents through the invalidator,
            // does not.
            if (! $ingredient->isDirty()) {
                continue;
            }

            $ingredient->save();

            $written++;

            if (! $scheduleDependants) {
                continue;
            }

            // Marks every published version whose lines cite this ingredient
            // stale and queues its recompute — which is how the parent's own
            // snapshot picks the new figures up. The layer is the row's own
            // owner, as everywhere else nutrition is invalidated.
            $this->invalidator->invalidate($ingredient, $ingredient->organisation_id);
        }

        return $written;
    }

    /**
     * The ingredients this version produces, restricted to the ones its own
     * organisation owns.
     *
     * `withoutTenancy()` because the job runs with no request behind it, and
     * the organisation filter because a tenant may legitimately name a
     * *platform* ingredient as an output — the picker offers the shared library
     * — and writing one kitchen's derived figures onto a row every other
     * kitchen reads would be a cross-tenant write dressed up as a publication.
     * Such an output keeps whatever the library states.
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
