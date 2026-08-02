<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for an edit to an energy band.
 *
 * The `min < max` rule is left entirely to the service here: a PATCH may carry
 * one end of the range and not the other, so the comparison has to run against
 * the merged row rather than against the request.
 */
class UpdateEnergyBandRequest extends FormRequest
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
            'min_kcal' => ['sometimes', 'integer', 'min:0', 'max:20000'],
            'max_kcal' => ['sometimes', 'integer', 'min:1', 'max:20000'],
            'display_order' => ['sometimes', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
