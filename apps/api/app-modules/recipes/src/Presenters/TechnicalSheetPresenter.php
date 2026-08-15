<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Presenters;

use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersionLine;

/**
 * The **confidential** cost projection of a recipe version — the only
 * presenter in this module that serialises money.
 *
 * It exists as a separate class rather than as a flag on
 * `RecipeVersionPresenter` for one reason: a boolean parameter is a decision
 * made at every call site, and the call site that forgets it leaks a margin.
 * A separate type means the cost fields are unreachable from the ordinary
 * version, line and allergen responses by construction, and a test can assert
 * that by sweeping those endpoints for cost-shaped keys.
 *
 * Nothing here is ever public. Recipe lines, raw-material quantities, unit
 * costs, cost snapshots and waste coefficients are all on the master plan's
 * public denylist (§4.8); this projection is served to holders of
 * `recipe.view_costs_organisation` inside one organisation and to nobody else,
 * and every successful read is audited.
 */
final class TechnicalSheetPresenter
{
    /**
     * One costed formulation line.
     *
     * `line_cost_amount` is on the wire beside `unit_cost_amount` even though
     * one is derivable from the other, because on an `as_recorded` import they
     * legitimately disagree: the source sheet's own arithmetic is stored
     * verbatim, errors included, and a reader who could only see the inputs
     * would have no way to notice.
     *
     * @return array{
     *     id: string,
     *     line_number: int,
     *     ingredient_id: string,
     *     quantity: string|null,
     *     unit_id: string|null,
     *     unit_cost_amount: string|null,
     *     line_cost_amount: string|null,
     *     cost_currency_code: string|null,
     *     source_designation: string|null,
     *     comment: string|null
     * }
     */
    public function line(RecipeVersionLine $line): array
    {
        return [
            'id' => (string) $line->getKey(),
            'line_number' => $line->line_number,
            'ingredient_id' => $line->ingredient_id,
            'quantity' => $line->quantity === null ? null : (string) $line->quantity,
            'unit_id' => $line->unit_id,
            'unit_cost_amount' => $line->unit_cost_amount === null ? null : (string) $line->unit_cost_amount,
            'line_cost_amount' => $line->line_cost_amount === null ? null : (string) $line->line_cost_amount,
            'cost_currency_code' => $line->cost_currency_code,
            'source_designation' => $line->source_designation,
            'comment' => $line->comment,
        ];
    }

    /**
     * One snapshot.
     *
     * `source_label` and `basis_mismatch` travel together and always: the
     * label is what a source sheet claimed and the flag is whether the claim
     * survives contact with the version's yield (appendix D findings #1 and
     * #2). Serving the figures without the flag would hand a reader a number
     * that looks authoritative and is under review.
     *
     * @return array{
     *     id: string,
     *     recipe_version_id: string,
     *     basis: string,
     *     currency_code: string,
     *     total_input_cost_amount: string,
     *     cost_per_yield_unit_amount: string|null,
     *     yield_unit_id: string|null,
     *     cost_per_piece_amount: string|null,
     *     waste_coefficient_percent: string,
     *     cost_per_yield_unit_with_waste_amount: string|null,
     *     cost_per_piece_with_waste_amount: string|null,
     *     source_label: string|null,
     *     basis_mismatch: bool,
     *     calculated_at: string|null,
     *     created_at: string|null
     * }
     */
    public function snapshot(RecipeCostSnapshot $snapshot): array
    {
        return [
            'id' => (string) $snapshot->getKey(),
            'recipe_version_id' => $snapshot->recipe_version_id,
            'basis' => $snapshot->basis->value,
            'currency_code' => $snapshot->currency_code,
            'total_input_cost_amount' => (string) $snapshot->total_input_cost_amount,
            'cost_per_yield_unit_amount' => $snapshot->cost_per_yield_unit_amount === null ? null : (string) $snapshot->cost_per_yield_unit_amount,
            'yield_unit_id' => $snapshot->yield_unit_id,
            'cost_per_piece_amount' => $snapshot->cost_per_piece_amount === null ? null : (string) $snapshot->cost_per_piece_amount,
            'waste_coefficient_percent' => (string) $snapshot->waste_coefficient_percent,
            'cost_per_yield_unit_with_waste_amount' => $snapshot->cost_per_yield_unit_with_waste_amount === null ? null : (string) $snapshot->cost_per_yield_unit_with_waste_amount,
            'cost_per_piece_with_waste_amount' => $snapshot->cost_per_piece_with_waste_amount === null ? null : (string) $snapshot->cost_per_piece_with_waste_amount,
            'source_label' => $snapshot->source_label,
            'basis_mismatch' => $snapshot->basis_mismatch,
            'calculated_at' => $snapshot->calculated_at->toIso8601String(),
            'created_at' => $snapshot->created_at?->toIso8601String(),
        ];
    }
}
