<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\Ingredients\Contracts\IngredientWeeklyPriceLookup;
use Healthy360\Ingredients\Contracts\WeeklyIngredientPrice;

/**
 * The answer when Procurement is not installed: no ingredient has a weekly price.
 *
 * Bound by `IngredientsServiceProvider` and replaced by Procurement's
 * implementation when that module is present. Every caller already has to handle a
 * missing price — falling back to the typed purchase price and flagging that it
 * did — so this degrades recipe costing to exactly the behaviour it had before
 * weekly prices existed, rather than to an unbound interface that fails at the
 * container.
 */
final class NullIngredientWeeklyPriceLookup implements IngredientWeeklyPriceLookup
{
    public function standing(string $organisationId, string $ingredientId): ?WeeklyIngredientPrice
    {
        return null;
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice>
     */
    public function standingFor(string $organisationId, array $ingredientIds): array
    {
        return [];
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice>
     */
    public function atPublication(string $organisationId, string $publicationId, array $ingredientIds): array
    {
        return [];
    }
}
