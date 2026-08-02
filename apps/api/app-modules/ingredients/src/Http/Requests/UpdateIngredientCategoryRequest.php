<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for a partial category update. `code` is omitted deliberately:
 * it is the handle an import maps onto, and renaming it turns the next import
 * into a duplicate rather than a convergence.
 */
class UpdateIngredientCategoryRequest extends FormRequest
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
            'parent_id' => ['sometimes', 'nullable', 'uuid', Rule::exists('ingredient_categories', 'id')],
            'display_order' => ['sometimes', 'required', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'required', 'boolean'],
        ];
    }
}
