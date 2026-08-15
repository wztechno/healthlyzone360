<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for opening a new draft version.
 *
 * `copy_from_version` is a *version number*, not an identifier: it is what a
 * human reads on a technical sheet and what the list endpoint shows, and it is
 * unambiguous inside one recipe. The locator resolves it against this recipe
 * only, so a number belonging to another recipe cannot be reached.
 */
class StoreRecipeVersionRequest extends FormRequest
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
            'copy_from_version' => ['nullable', 'integer', 'min:1'],
        ];
    }

    public function copyFromVersion(): ?int
    {
        $value = $this->validated('copy_from_version');

        return is_numeric($value) ? (int) $value : null;
    }
}
