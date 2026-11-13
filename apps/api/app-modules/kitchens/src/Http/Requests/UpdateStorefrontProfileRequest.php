<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a kitchen's storefront copy. Every field may be empty: an
 * unset field renders as nothing on the marketplace.
 */
class UpdateStorefrontProfileRequest extends FormRequest
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
            'tagline_en' => ['present', 'nullable', 'string', 'max:160'],
            'tagline_ar' => ['present', 'nullable', 'string', 'max:160'],
            'description_en' => ['present', 'nullable', 'string', 'max:2000'],
            'description_ar' => ['present', 'nullable', 'string', 'max:2000'],
            'cuisines_en' => ['present', 'array', 'max:20'],
            'cuisines_en.*' => ['nullable', 'string', 'max:40'],
            'cuisines_ar' => ['present', 'array', 'max:20'],
            'cuisines_ar.*' => ['nullable', 'string', 'max:40'],
        ];
    }
}
