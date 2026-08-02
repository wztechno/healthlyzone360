<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Validation for editing an allergen class.
 *
 * `code` is not merely absent from the rules — it is actively rejected. An
 * unlisted field would be silently dropped, which would let a caller believe
 * a rename succeeded; a canonical regulatory identity deserves an explicit
 * refusal instead of a quiet no-op.
 */
class UpdateAllergenClassRequest extends FormRequest
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
            'description_en' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'description_ar' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'regulatory_ref' => ['sometimes', 'required', 'string', 'max:20'],
            'is_eu_14' => ['sometimes', 'required', 'boolean'],
            'is_us_big_9' => ['sometimes', 'required', 'boolean'],
            'us_declaration_required' => ['sometimes', 'required', 'boolean'],
            'us_threshold_ppm' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000000'],
            'display_order' => ['sometimes', 'required', 'integer', 'min:0', 'max:100000'],
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($this->has('code')) {
                    $validator->errors()->add('code', 'The allergen class code is a regulatory identity and cannot be changed.');
                }
            },
        ];
    }
}
