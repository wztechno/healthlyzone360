<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Contracts;

use Healthy360\Ingredients\Models\Ingredient;

/**
 * What else in the platform is holding on to an ingredient.
 *
 * The ingredients module cannot ask the recipes module directly: the
 * dependency edge runs Recipes → Ingredients, and reversing it would be a
 * cycle. So the ingredients module declares the question and the recipes
 * module answers it — an ordinary port, bound by whichever module is present.
 * `NullIngredientUsageRegistry` is the answer when nothing depends on
 * ingredients yet, which is also what keeps the K1.1 behaviour intact if the
 * recipes module is ever removed.
 *
 * Two questions, both of which only a downstream module can answer:
 *
 * 1. **Is this ingredient still in use?** Archiving an ingredient a live
 *    formulation references would leave a published recipe pointing at
 *    history.
 * 2. **Whose derived allergen labels does a mapping change invalidate?** A
 *    frozen label is only as good as the mappings it was computed from, and
 *    the moment one changes the label is stale — which must be recorded, not
 *    inferred later.
 */
interface IngredientUsageRegistry
{
    /**
     * Live references to this ingredient — anything that would be left
     * dangling if it were archived.
     *
     * "Live" excludes retired recipe versions: history is allowed to point at
     * an archived ingredient, that is what history is.
     *
     * @return array{recipe_ids: list<string>, recipe_version_ids: list<string>}
     */
    public function activeReferences(Ingredient $ingredient): array;

    /**
     * Mark every published recipe version whose lines reference this
     * ingredient as having a stale derived allergen label, and return how many
     * were marked.
     *
     * Marking, not recomputing: a recompute inside a mapping write would make
     * an allergen edit take as long as the largest recipe that uses the
     * ingredient, and would run the food-safety derivation inside somebody
     * else's transaction. The reactive recompute (and the quarantine it can
     * raise) is the K1.8 job.
     */
    public function markDependentDerivationsStale(Ingredient $ingredient): int;
}
