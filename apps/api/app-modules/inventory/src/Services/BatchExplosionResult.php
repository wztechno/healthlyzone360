<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

/**
 * What one production batch takes off the shelf (PROD1) — the same reading
 * {@see MealExplosionResult} gives a sale, split by what the two halves mean.
 *
 * Ingredients and packaging arrive as separate lists rather than one, because a
 * production order stores them as separate lines with a `line_kind` and the two
 * behave differently at completion: a cook reports actual ingredient
 * consumption and waste against the pot, while packaging is taken as planned or
 * not at all. A sale has no such split — it deducts both and values both as
 * cost of goods — which is why `explode()` still returns one flat list and this
 * is a second shape rather than a change to that one.
 *
 * Nothing here has written anything, exactly as on the sale side. A caller
 * reserves against these rows, or renders them as a plan, or both.
 *
 * @phpstan-import-type ConsumptionFailure from MealExplosionResult
 * @phpstan-import-type ExplodedIngredient from MealExplosionResult
 */
final readonly class BatchExplosionResult
{
    /**
     * @param  list<ExplodedIngredient>  $ingredients  the formulation, scaled to the batch factor
     * @param  list<ExplodedIngredient>  $packaging  the consumables, scaled and rounded **up** on anything counted
     * @param  list<ConsumptionFailure>  $failures  one per ingredient that could not be answered; `catalogue_item_id` is null throughout, because a batch is not a sale
     */
    public function __construct(
        public array $ingredients = [],
        public array $packaging = [],
        public array $failures = [],
    ) {}
}
