<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Contracts;

/**
 * One ingredient's published weekly price, as the modules that *estimate* with it
 * need to read it.
 *
 * Deliberately a small value object in the ingredients module rather than the
 * `IngredientWeeklyPrice` model itself. Recipes and Inventory both cost with this
 * figure and neither may depend on Procurement — `Procurement → Inventory →
 * Recipes` already exists, so an edge the other way would close a cycle the
 * architecture test rejects. Handing back the model would be that edge by another
 * name.
 *
 * `effectiveFrom` is on the object rather than left to the caller because the
 * requirement asks for it by name: an ingredient with no purchases keeps its most
 * recent weekly price **and displays its effective date**. A figure whose age is
 * invisible is one somebody will mistake for this week's.
 *
 * `source` is `computed` or `carried_forward`. There is no member for "unpriced":
 * an ingredient with no usable price has **no** price object at all, so a caller
 * cannot accidentally read a zero out of one. That is the same reason
 * `CostComputation` reports incompleteness rather than returning a partial total.
 */
final readonly class WeeklyIngredientPrice
{
    /**
     * @param  numeric-string  $amount  major currency units (§4.4), per $unitId
     * @param  'computed'|'carried_forward'  $source
     */
    public function __construct(
        public string $ingredientId,
        public string $amount,
        public string $currencyCode,
        public string $unitId,
        public string $effectiveFrom,
        public string $purchaseWeekStartDate,
        public string $source,
        public string $publicationId,
    ) {}

    public function isCarriedForward(): bool
    {
        return $this->source === 'carried_forward';
    }
}
