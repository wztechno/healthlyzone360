<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Requests;

use Healthy360\Ingredients\Enums\AvailabilityTier;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for a partial ingredient update.
 *
 * `slug` is not editable: it is the stable handle a re-import and an operator
 * edit both key on, and renaming it would make the next import create a
 * duplicate instead of converging. `status` is not editable either — status
 * changes are lifecycle actions with their own routes and audit actions
 * (master plan v2 §4.15).
 */
class UpdateIngredientRequest extends FormRequest
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
            'name_en' => ['sometimes', 'required', 'string', 'max:255'],
            'name_ar' => ['sometimes', 'required', 'string', 'max:255'],
            'ingredient_category_id' => ['sometimes', 'nullable', 'uuid', Rule::exists('ingredient_categories', 'id')],
            'ingredient_subcategory_id' => ['sometimes', 'nullable', 'uuid', Rule::exists('ingredient_categories', 'id')],
            'default_unit_id' => ['sometimes', 'required', 'uuid', Rule::exists('measurement_units', 'id')],
            'yield_factor' => ['sometimes', 'required', 'numeric', 'gt:0', 'max:99.9999'],
            'availability_tier' => ['sometimes', 'nullable', new Enum(AvailabilityTier::class)],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }
}
