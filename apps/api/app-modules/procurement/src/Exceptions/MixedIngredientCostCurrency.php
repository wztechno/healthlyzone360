<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A purchase would blend a new currency into an ingredient's existing
 * moving-average cost.
 *
 * The weighted average is one running figure per `(organisation, ingredient)`,
 * and it carries exactly one currency for the same reason a recipe's costed
 * lines do (`MixedCostCurrency`, master plan v2 §4.4): there is no exchange
 * rate anywhere in this system, so `(old_qty·old_avg + recv_qty·recv_cost)` in
 * two currencies is a number nobody could reconcile. A kitchen that starts
 * buying an ingredient in a second currency has a bookkeeping decision to make
 * — it is not one this system may make for it by inventing a rate.
 *
 * The refusal names both currencies so the fix is obvious: post the receipt in
 * the currency the ingredient's cost already carries, or reset that cost
 * deliberately.
 */
final class MixedIngredientCostCurrency extends ApiException
{
    public function __construct(string $existingCurrency, string $incomingCurrency, string $ingredientId)
    {
        parent::__construct(
            ErrorCode::ValidationFailed,
            "This ingredient's cost is held in {$existingCurrency}, and this system never converts between currencies, so a purchase in {$incomingCurrency} cannot be blended into it.",
            [
                'existing_currency' => $existingCurrency,
                'incoming_currency' => $incomingCurrency,
                'ingredient_id' => $ingredientId,
            ],
        );
    }
}
