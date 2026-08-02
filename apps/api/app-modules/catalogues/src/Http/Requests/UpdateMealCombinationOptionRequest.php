<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for an edit to a meal combination.
 *
 * `code` is absent deliberately, and a submitted one is refused by the
 * controller rather than ignored: a code is what a plan configuration's
 * identifier is derived from, so moving it would rename variants a price
 * already points at. `is_active` is here because deactivation *is* the
 * withdrawal — there is no delete.
 */
class UpdateMealCombinationOptionRequest extends FormRequest
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
            'name_en' => ['sometimes', 'string', 'max:255'],
            'name_ar' => ['sometimes', 'string', 'max:255'],
            'includes_breakfast' => ['sometimes', 'boolean'],
            'includes_lunch' => ['sometimes', 'boolean'],
            'includes_dinner' => ['sometimes', 'boolean'],
            'meals_per_day' => ['sometimes', 'integer', 'gt:0', 'max:12'],
            'display_order' => ['sometimes', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
