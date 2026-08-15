<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a new energy band.
 *
 * `gt:min_kcal` is expressed here as well as in the service and in the CHECK.
 * The three layers say the same thing to three audiences: this one names the
 * offending field for a form, the service says it in a sentence for an API
 * client, and the constraint says it to every writer there will ever be.
 */
class StoreEnergyBandRequest extends FormRequest
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
            'min_kcal' => ['required', 'integer', 'min:0', 'max:20000'],
            'max_kcal' => ['required', 'integer', 'gt:min_kcal', 'max:20000'],
            'display_order' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
