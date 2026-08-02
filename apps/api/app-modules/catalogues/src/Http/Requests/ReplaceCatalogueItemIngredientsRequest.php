<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of an item's public ingredient list.
 *
 * `display_order` is not a field: the array order **is** the sequence, so a
 * client never has to keep numbering in step with an insertion and two rows
 * can never claim the same position.
 *
 * There is no quantity field, and that absence is load-bearing. Quantities are
 * the formulation, the formulation is confidential, and a shape that accepted
 * one here would put a competitor's proportions behind an endpoint whose whole
 * purpose is what a customer reads.
 */
class ReplaceCatalogueItemIngredientsRequest extends FormRequest
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
            'ingredients' => ['present', 'array', 'max:100'],
            'ingredients.*.ingredient_id' => ['required', 'uuid'],
            'ingredients.*.is_representative' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return list<array{ingredient_id: string, is_representative?: bool}>
     */
    public function ingredients(): array
    {
        /** @var list<array{ingredient_id: string, is_representative?: bool}> $ingredients */
        $ingredients = $this->validated('ingredients') ?? [];

        return $ingredients;
    }
}
