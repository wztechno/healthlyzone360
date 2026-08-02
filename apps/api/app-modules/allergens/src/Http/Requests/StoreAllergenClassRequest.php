<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for creating an allergen class. The `code` is accepted here and
 * nowhere else: it can be chosen once and never changed.
 */
class StoreAllergenClassRequest extends FormRequest
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
            'code' => ['required', 'string', 'max:20', 'regex:/^[a-z][a-z0-9_]*$/'],
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['required', 'string', 'max:255'],
            'description_en' => ['nullable', 'string', 'max:2000'],
            'description_ar' => ['nullable', 'string', 'max:2000'],
            'regulatory_ref' => ['required', 'string', 'max:20'],
            'is_eu_14' => ['required', 'boolean'],
            'is_us_big_9' => ['required', 'boolean'],
            'us_declaration_required' => ['nullable', 'boolean'],
            'us_threshold_ppm' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'display_order' => ['nullable', 'integer', 'min:0', 'max:100000'],
        ];
    }
}
