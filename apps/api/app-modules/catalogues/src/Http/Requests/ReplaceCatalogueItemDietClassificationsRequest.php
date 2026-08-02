<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of an item's diet tags.
 *
 * Tags arrive as platform **codes** (`vegan`, `keto`), which is what the admin
 * contract carries and what a human reads. A code that does not resolve to an
 * active classification is a validation failure, never an invitation to create
 * one: the vocabulary is platform reference data, and a kitchen that could
 * invent "keto-ish" would make the customer-side filter meaningless the first
 * time two kitchens spelt one idea differently.
 */
class ReplaceCatalogueItemDietClassificationsRequest extends FormRequest
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
            'diet_classifications' => ['present', 'array', 'max:20'],
            'diet_classifications.*' => ['required', 'string', 'max:40'],
        ];
    }

    /**
     * @return list<string>
     */
    public function codes(): array
    {
        /** @var list<string> $codes */
        $codes = $this->validated('diet_classifications') ?? [];

        return $codes;
    }
}
