<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a new meal combination.
 *
 * `is_active` is **not** a field. A combination is created offered — creating
 * one already withdrawn is not a thing a kitchen means to do — and withdrawal
 * is the PATCH, where it belongs.
 *
 * "At least one sitting" is checked in the service rather than here, because
 * the PATCH has to apply the same rule against the *merged* row and a duplicate
 * of the check in two places is a rule that will eventually disagree with
 * itself.
 */
class StoreMealCombinationOptionRequest extends FormRequest
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
            'code' => ['required', 'string', 'max:40'],
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['nullable', 'string', 'max:255'],
            'includes_breakfast' => ['nullable', 'boolean'],
            'includes_lunch' => ['nullable', 'boolean'],
            'includes_dinner' => ['nullable', 'boolean'],
            'meals_per_day' => ['required', 'integer', 'gt:0', 'max:12'],
            'display_order' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
