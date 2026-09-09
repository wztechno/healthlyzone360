<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Healthy360\Recipes\Enums\RecipeCompleteness;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for editing a draft (or quarantined) version's header.
 *
 * `status`, `derivation_state`, `derived_at`, `derived_input_hash`,
 * `published_at` and `published_by` are all absent: every one of them is a
 * conclusion the server reached, and a client that could post
 * `derivation_state: current` could declare an allergen label fresh without
 * anything having been computed.
 */
class UpdateRecipeVersionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'completeness' => ['sometimes', new Enum(RecipeCompleteness::class)],
            'yield_quantity' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:99999999.9999'],
            'yield_unit_id' => ['sometimes', 'nullable', 'uuid', Rule::exists('measurement_units', 'id')],
            'yield_piece_count' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'input_quantity_total' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:99999999.9999'],
            'waste_coefficient_percent' => ['sometimes', 'numeric', 'min:0', 'max:999.99'],
            /*
             * Packaging loss, and a second coefficient rather than a reuse of
             * the one above. Process loss is sauce left in the pot; packaging
             * loss is mis-fed labels and split film. The source sheet states
             * different percentages for each, and one field for both would make
             * correcting either silently rewrite the other.
             *
             * `lt:100` and not the neighbour's `max:999.99`, matching this
             * column's own CHECK. A hundred per cent packaging loss is packaging
             * that never survives being used, which nobody stocks; the
             * production coefficient is looser because a reduction really can
             * lose most of its mass.
             */
            'packaging_waste_percent' => ['sometimes', 'numeric', 'min:0', 'lt:100'],
            /*
             * The two list prices the version is sold at, per unit of its
             * yield — trade and consumer. Two fields and not the one "selling
             * price" the editor used to collect: a single figure is right for
             * one channel and wrong for the other, and the margin it feeds
             * inherits the error.
             *
             * `min:0` and not `gt:0`: zero is a real list price — a staff
             * meal, a tasting portion, a component carried at cost inside a
             * plan — and `nullable` is how a price is *cleared*, which is a
             * different act from pricing something at nothing.
             *
             * `price_currency_code` is `required_with` both amounts rather
             * than either, matching `StoreIngredientRequest`: a monetary value
             * without its currency is not a monetary value (§4.4), and the
             * column CHECK says the same thing one layer down.
             */
            'b2b_price_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:999999999999.999999'],
            'b2c_price_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:999999999999.999999'],
            'price_currency_code' => ['required_with:b2b_price_amount,b2c_price_amount', 'nullable', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }
}
