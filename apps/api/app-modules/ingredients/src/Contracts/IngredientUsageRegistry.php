<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Contracts;

use Healthy360\Ingredients\Models\Ingredient;

/**
 * What else in the platform is holding on to an ingredient.
 *
 * The ingredients module cannot ask the recipes module directly: the
 * dependency edge runs Recipes → Ingredients, and reversing it would be a
 * cycle. So the ingredients module declares the question and the downstream
 * modules answer it — an ordinary port, bound by whichever module is present.
 * `NullIngredientUsageRegistry` is the answer when nothing depends on
 * ingredients yet, which is also what keeps the K1.1 behaviour intact if the
 * recipes module is ever removed.
 *
 * **More than one module can answer** (K1.4). Recipes bind an implementation;
 * catalogues decorate it, so an ingredient named by a live catalogue item's
 * public ingredient list is as unarchivable as one named by a live
 * formulation. The composition is a decorator rather than a registry of
 * registries because the question has one answer — "here is everything
 * holding it" — and a caller that had to merge N answers itself would
 * eventually merge N-1 of them.
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
     * "Live" excludes retired recipe versions and retired catalogue items:
     * history is allowed to point at an archived ingredient, that is what
     * history is.
     *
     * The three lists are reported separately rather than merged into one bag
     * of identifiers because a client has to be able to say *what* is holding
     * the row — "two recipe versions" and "a published dish" send a kitchen to
     * different screens.
     *
     * @return array{recipe_ids: list<string>, recipe_version_ids: list<string>, catalogue_item_ids: list<string>}
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
