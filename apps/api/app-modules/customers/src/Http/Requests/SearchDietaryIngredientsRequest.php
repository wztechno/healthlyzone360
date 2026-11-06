<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `GET /me/dietary-profile/ingredients?q=…` — what the person has typed.
 *
 * Two characters at least: one letter matches half the library and tells the
 * person nothing, and the box answers as they type. The page is small and
 * capped because this feeds a dropdown under a text field, not a list anybody
 * scrolls.
 */
class SearchDietaryIngredientsRequest extends FormRequest
{
    public const int DEFAULT_LIMIT = 8;

    /**
     * The route's `auth` and `verified` middleware are the gate; the search
     * itself names nothing private.
     */
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
            'q' => ['required', 'string', 'min:2', 'max:60'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:20'],
        ];
    }

    public function term(): string
    {
        return trim($this->string('q')->toString());
    }

    public function limit(): int
    {
        return $this->integer('limit', self::DEFAULT_LIMIT);
    }

    /**
     * Trimmed before the length rule runs, so two spaces are not a search.
     */
    protected function prepareForValidation(): void
    {
        $q = $this->query('q');

        if (is_string($q)) {
            $this->merge(['q' => trim($q)]);
        }
    }
}
