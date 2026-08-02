<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for adding an alias. `alias_normalised` is never accepted from a
 * client — the model derives it, so one writer cannot normalise differently
 * from another and silently break designation lookup.
 */
class StoreIngredientAliasRequest extends FormRequest
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
            'alias' => ['required', 'string', 'max:160'],
            'locale' => ['nullable', 'string', 'max:5', Rule::in(['en', 'ar'])],
        ];
    }
}
