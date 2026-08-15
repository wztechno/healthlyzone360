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
 * Three questions, all of which only a downstream module can answer:
 *
 * 1. **Is this ingredient still in use?** Archiving an ingredient a live
 *    formulation references would leave a published recipe pointing at
 *    history.
 * 2. **Whose derived allergen labels does a mapping change invalidate?** A
 *    frozen label is only as good as the mappings it was computed from, and
 *    the moment one changes the label is stale — which must be recorded, not
 *    inferred later.
 * 3. **Which organisations does a platform-baseline change reach?** A baseline
 *    correction is one write with as many consequences as there are tenants
 *    using the ingredient, and the mapping editor cannot enumerate them without
 *    knowing what a recipe is (K1.8).
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
     * ingredient as having a stale derived allergen label, **schedule the
     * recompute of each**, and return the identifiers marked.
     *
     * Two halves, and the split is the point. The marking is synchronous
     * because a label whose basis has moved must never look current for even
     * one read; the recompute is a queued job because it re-derives a
     * food-safety conclusion, can quarantine a published version and can cost a
     * whole recipe, none of which belongs inside the mapping editor's request.
     * Doing the derivation here would make an allergen edit take as long as the
     * largest recipe that uses the ingredient.
     *
     * The scheduling lives behind this port rather than in the caller for a
     * structural reason: the job is a *recipes* class, and the ingredients
     * module referencing it would reverse the Recipes → Ingredients edge into a
     * cycle. The implementation that knows which versions to mark is the one
     * that may name the job.
     *
     * Identifiers rather than a count, since K1.8: the caller audits a count,
     * but a test that asserts the right versions were touched needs to know
     * which, and a registry that answered "three" would make that unknowable.
     *
     * @return list<string> the recipe version identifiers marked, in the
     *                      **active organisation** only
     */
    public function markDependentDerivationsStale(Ingredient $ingredient): array;

    /**
     * Every organisation with a live recipe version whose lines use this
     * ingredient — read across tenants, on purpose (K1.8).
     *
     * The platform-baseline fan-out. A platform operator correcting the
     * baseline for one ingredient invalidates labels in every kitchen that uses
     * it, and `markDependentDerivationsStale()` can only ever reach the
     * organisation the caller is in. So the mapping editor asks this, then
     * restores each organisation's context in turn and marks inside it. Two
     * calls rather than one method that does everything, because the context
     * switching is tenancy's business and the recipe query is this module's.
     *
     * Retired versions are excluded: history may point at whatever it likes,
     * and recomputing a label nobody can see is work with no reader.
     *
     * @return list<string> organisation identifiers, ordered, without duplicates
     */
    public function dependentOrganisationIds(Ingredient $ingredient): array;
}
