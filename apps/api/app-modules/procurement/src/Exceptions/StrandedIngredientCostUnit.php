<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * An ingredient's stock unit has moved, and the balance held against the old one
 * cannot be re-denominated into the new one.
 *
 * `ingredient_stock_costs` holds two figures that are only meaningful together
 * with `unit_id`: `quantity_on_hand`, and a `moving_average_cost_amount` that is
 * a price *per one of that unit*. When an ingredient's `default_unit_id` changes
 * underneath an existing balance, those two stop describing the same thing as
 * the incoming receipt.
 *
 * Where the two units are convertible the service rebases instead of throwing —
 * `kg` to `g` is exact and there is nothing to decide. This exception is the
 * other case: `piece` to `kg`, `l` to `kg`, anything crossing a dimension.
 * Forty pieces of something are still physically on the shelf; what they weigh
 * is a fact this system has never recorded, and no arithmetic here can recover
 * it.
 *
 * ## Why this refuses rather than guessing
 *
 * The blend is `(old_qty·old_avg + recv_qty·recv_cost) ÷ new_qty`. With the two
 * sides in different units every term of that is wrong, and wrong *quietly*: the
 * result is a plausible number in a money column, and the line before this one
 * used to overwrite `unit_id` with the ingredient's new unit — relabelling the
 * evidence so nothing downstream could even detect the mix. Every subsequent
 * COGS valuation, every monthly report and every margin drawn from that average
 * inherits the error with no marker.
 *
 * Refusing costs one receipt. Guessing costs every figure derived from the
 * ingredient thereafter, and does not say so.
 *
 * ## What clears it
 *
 * A stock count in the new unit, which is the only place the missing fact can
 * come from. That is a deliberate act by somebody who can look at the shelf, and
 * it is what a unit migration is expected to have listed and had signed off
 * before it ran — the refusal here is the backstop for a row that slipped
 * through, not the intended route.
 */
final class StrandedIngredientCostUnit extends ApiException
{
    public function __construct(string $heldUnitCode, string $ingredientUnitCode, string $ingredientId)
    {
        parent::__construct(
            ErrorCode::ValidationFailed,
            "This ingredient's cost is held per {$heldUnitCode} and the ingredient now stocks in {$ingredientUnitCode}, which is not a conversion this system can make. Count the shelf in {$ingredientUnitCode} before receiving against it.",
            [
                'held_unit' => $heldUnitCode,
                'ingredient_unit' => $ingredientUnitCode,
                'ingredient_id' => $ingredientId,
            ],
        );
    }
}
