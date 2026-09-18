<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Contracts;

/**
 * What an ingredient cost, on average, over the most recent week that has a
 * published price — the estimating basis for recipe costing, technical sheets and
 * production plans (PROD1).
 *
 * The ingredients module declares the question and Procurement answers it, the
 * same inverted port as {@see IngredientUsageRegistry}. The edge has to run this
 * way round: the figure is computed from `goods_receipt_lines`, which Procurement
 * owns, and the callers are Recipes and Inventory, neither of which may depend on
 * Procurement without closing the `Procurement → Inventory → Recipes` cycle.
 * Declaring it here — upstream of all three — costs no new registry edge at all.
 *
 * {@see NullIngredientWeeklyPriceLookup} is the answer before Procurement is
 * installed, and is what keeps recipe costing working and testable without it.
 *
 * **A missing price is null, never zero.** Every caller is expected to fall back
 * to the ingredient's typed purchase price and say visibly that it did, or to
 * leave the line uncosted. A zero here would cost a whole formulation wrongly and
 * silently, which is the one failure the costing layer's complete/partial
 * distinction exists to prevent.
 */
interface IngredientWeeklyPriceLookup
{
    /**
     * The standing weekly price for one ingredient, or null when it has never been
     * bought at a recorded price that can be expressed in the unit it stocks in
     * today.
     */
    public function standing(string $organisationId, string $ingredientId): ?WeeklyIngredientPrice;

    /**
     * The standing weekly price for many ingredients, in one read.
     *
     * A batch method rather than a loop over {@see standing()} because costing a
     * formulation asks about every line at once, and a technical sheet that issued
     * one query per ingredient would be an N+1 on the most-read cost surface in
     * the product.
     *
     * Ingredients with no usable price are **absent from the result**, not present
     * with a null — a caller iterating the map then cannot mistake a missing price
     * for a free ingredient.
     *
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice> keyed by ingredient id
     */
    public function standingFor(string $organisationId, array $ingredientIds): array;

    /**
     * The prices as one specific publication published them — what a completed
     * production batch pinned, so that later publications cannot move a historical
     * estimate.
     *
     * Reads that publication's own rows rather than "the newest row at or before
     * its date", because the two differ the moment a week is recomputed and the
     * pinned answer must be the one the batch actually saw.
     *
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice> keyed by ingredient id
     */
    public function atPublication(string $organisationId, string $publicationId, array $ingredientIds): array;
}
