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
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }
}
