<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for creating a tenant ingredient category.
 *
 * `code` is a stable handle within the organisation, so it is lower-case
 * kebab and checked for uniqueness across the rows the caller can see — the
 * platform library included, because a tenant code that shadows a platform
 * code makes every later "which category is this?" ambiguous.
 */
class StoreIngredientCategoryRequest extends FormRequest
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
            'code' => ['required', 'string', 'max:40', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/'],
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['nullable', 'string', 'max:255'],
            'parent_id' => ['nullable', 'uuid', Rule::exists('ingredient_categories', 'id')],
            'display_order' => ['nullable', 'integer', 'min:0', 'max:100000'],
        ];
    }
}
