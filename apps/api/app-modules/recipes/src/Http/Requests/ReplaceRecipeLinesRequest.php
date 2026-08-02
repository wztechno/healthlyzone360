<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of a version's lines.
 *
 * `lines` is `present`, not `required`: an empty array is a legitimate
 * statement ("this version has no lines yet") and `required` would reject it
 * as if the field had been forgotten. On a formulation the difference between
 * "removed" and "omitted" is the whole reason this is a PUT.
 *
 * `line_number` is not a field. The array order is the sequence, so a client
 * never has to keep numbering in step with an insertion, and two lines can
 * never claim the same position.
 *
 * The cost fields are not accepted here. They exist on the table and arrive
 * with the importer; the cost editing surface is K1.3, behind
 * `recipe.view_costs_organisation`.
 */
class ReplaceRecipeLinesRequest extends FormRequest
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
            'lines' => ['present', 'array', 'max:200'],

            // Existence is checked in the service, not here: the ingredient
            // must be one *this organisation* can use (its own rows plus the
            // platform library), and a bare `exists` rule would happily accept
            // another tenant's ingredient identifier.
            'lines.*.ingredient_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['nullable', 'numeric', 'gt:0', 'max:99999999.9999'],
            'lines.*.unit_id' => ['nullable', 'uuid'],
            'lines.*.source_designation' => ['nullable', 'string', 'max:160'],
            'lines.*.comment' => ['nullable', 'string', 'max:255'],
        ];
    }

    /**
     * @return list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, source_designation?: string|null, comment?: string|null}>
     */
    public function lines(): array
    {
        /** @var list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, source_designation?: string|null, comment?: string|null}> $lines */
        $lines = $this->validated('lines') ?? [];

        return $lines;
    }
}
