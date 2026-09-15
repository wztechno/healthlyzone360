<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Presenters;

use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Recipes\Models\RecipeVersionStep;

/**
 * The administrative wire shapes of a recipe version.
 *
 * **Costs are omitted from `line()` deliberately.** `recipe_version_lines`
 * carries `unit_cost_amount`, `line_cost_amount` and `cost_currency_code`, and
 * this presenter does not read them. The cost projection is **K1.3**, behind
 * the `recipe.view_costs_organisation` permission split; until that permission
 * exists there is no way to serve a cost to the right people, so the honest
 * projection is the one that serves it to nobody. A reviewer looking for the
 * cost fields should find this paragraph, not an oversight.
 *
 * Nothing here is a public projection either. Recipe lines, raw-material
 * quantities and yields are on the master plan's public denylist (§4.8); the
 * only part of a version that is ever meant to reach a diner is the allergen
 * label, and that gets its own presenter when a consumer surface exists (M1).
 */
final class RecipeVersionPresenter
{
    /**
     * The version header — enough for a list row, and the same shape inside
     * the single-version response so a client has one thing to parse.
     *
     * @return array{
     *     id: string,
     *     recipe_id: string,
     *     version_number: int,
     *     status: string,
     *     completeness: string,
     *     yield_quantity: string|null,
     *     yield_unit_id: string|null,
     *     yield_piece_count: int|null,
     *     input_quantity_total: string|null,
     *     waste_coefficient_percent: string,
     *     packaging_waste_percent: string,
     *     b2b_price_amount: string|null,
     *     b2c_price_amount: string|null,
     *     price_currency_code: string|null,
     *     derivation_state: string,
     *     derived_at: string|null,
     *     published_at: string|null,
     *     review_reason: string|null,
     *     notes: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function version(RecipeVersion $version): array
    {
        return [
            'id' => (string) $version->getKey(),
            'recipe_id' => $version->recipe_id,
            'version_number' => $version->version_number,
            'status' => $version->status->value,
            'completeness' => $version->completeness->value,
            'yield_quantity' => $version->yield_quantity === null ? null : (string) $version->yield_quantity,
            'yield_unit_id' => $version->yield_unit_id,
            'yield_piece_count' => $version->yield_piece_count,
            'input_quantity_total' => $version->input_quantity_total === null ? null : (string) $version->input_quantity_total,
            'waste_coefficient_percent' => (string) $version->waste_coefficient_percent,

            // A second coefficient, beside the process one and never merged
            // with it. Process loss is sauce left in the pot; packaging loss is
            // mis-fed labels and split film. The source sheet states different
            // percentages for each, and one field for both would make
            // correcting either silently rewrite the other.
            'packaging_waste_percent' => (string) $version->packaging_waste_percent,

            /*
             * The two list prices, per unit of yield — and the only money this
             * presenter serves. They are not a breach of the "no cost fields"
             * rule the class docblock states: a cost is what the kitchen paid
             * for the inputs and stays behind `recipe.view_costs_organisation`
             * with the rest of K1.3, whereas a list price is what the version
             * is offered at. The B2C figure ends up on a menu.
             *
             * Strings, like every other decimal here, so no client rounds a
             * price on the way in.
             */
            'b2b_price_amount' => $version->b2b_price_amount === null ? null : (string) $version->b2b_price_amount,
            'b2c_price_amount' => $version->b2c_price_amount === null ? null : (string) $version->b2c_price_amount,
            'price_currency_code' => $version->price_currency_code,

            // On the wire because a client must be able to say "this label was
            // computed before the mappings changed" without asking a second
            // endpoint. `derived_input_hash` is not: it is an internal
            // fingerprint, and publishing it would invite clients to compare
            // hashes instead of reading the state.
            'derivation_state' => $version->derivation_state->value,
            'derived_at' => $version->derived_at?->toIso8601String(),
            'published_at' => $version->published_at?->toIso8601String(),
            'review_reason' => $version->review_reason,
            'notes' => $version->notes,
            'lock_version' => $version->lock_version,
            'created_at' => $version->created_at?->toIso8601String(),
            'updated_at' => $version->updated_at?->toIso8601String(),
        ];
    }

    /**
     * One formulation line. **No cost fields** — see the class docblock.
     *
     * @return array{
     *     id: string,
     *     line_number: int,
     *     ingredient_id: string,
     *     quantity: string|null,
     *     unit_id: string|null,
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
            'source_designation' => $line->source_designation,
            'comment' => $line->comment,
        ];
    }

    /**
     * One packaging line. **No cost fields** — see the class docblock.
     *
     * `basis` travels beside `quantity` and always, because without it the
     * quantity is unreadable: `6` means "the yield fills six of these" on one
     * basis and "somebody typed six" on another, and only the first will still
     * be right after the yield changes. A client renders the two together or
     * renders a number nobody can check.
     *
     * @return array{
     *     id: string,
     *     line_number: int,
     *     ingredient_id: string,
     *     basis: string,
     *     quantity: string,
     *     unit_id: string|null,
     *     comment: string|null
     * }
     */
    public function packaging(RecipeVersionPackaging $row): array
    {
        return [
            'id' => (string) $row->getKey(),
            'line_number' => $row->line_number,
            'ingredient_id' => $row->ingredient_id,
            'basis' => $row->basis->value,
            'quantity' => (string) $row->quantity,
            'unit_id' => $row->unit_id,
            'comment' => $row->comment,
        ];
    }

    /**
     * @return array{id: string, ingredient_id: string, output_quantity: string, unit_id: string, is_primary: bool}
     */
    public function output(RecipeVersionOutput $output): array
    {
        return [
            'id' => (string) $output->getKey(),
            'ingredient_id' => $output->ingredient_id,
            'output_quantity' => (string) $output->output_quantity,
            'unit_id' => $output->unit_id,
            'is_primary' => $output->is_primary,
        ];
    }

    /**
     * @return array{id: string, step_number: int, instruction_en: string, instruction_ar: string|null, minutes: int|null}
     */
    public function step(RecipeVersionStep $step): array
    {
        return [
            'id' => (string) $step->getKey(),
            'step_number' => $step->step_number,
            'instruction_en' => $step->instruction_en,
            'instruction_ar' => $step->instruction_ar,
            'minutes' => $step->minutes,
        ];
    }

    /**
     * One row of the frozen label. `derivation` and `source_ingredient_id` are
     * on the wire because provenance is what makes a warning trusted: "sesame,
     * from tahini" is acted on where a bare "sesame" is clicked past.
     *
     * @return array{
     *     id: string,
     *     allergen_code: string,
     *     containment: string,
     *     derivation: string,
     *     source_ingredient_id: string|null,
     *     source_note: string|null
     * }
     */
    public function allergen(RecipeVersionAllergen $allergen): array
    {
        return [
            'id' => (string) $allergen->getKey(),
            'allergen_code' => $allergen->allergen_code,
            'containment' => $allergen->containment->value,
            'derivation' => $allergen->derivation->value,
            'source_ingredient_id' => $allergen->source_ingredient_id,
            'source_note' => $allergen->source_note,
        ];
    }
}
