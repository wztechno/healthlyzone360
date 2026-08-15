<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * Validation for a draft formulation roll-up preview.
 *
 * Nothing here is persisted. The body mirrors what a line editor would send
 * while somebody is still composing a version, including optional per-line
 * costs when the caller may see money.
 */
class PreviewRecipeRollupRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('recipe.view_organisation')
            || Gate::allows('recipe.manage_organisation');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'recipe_id' => ['nullable', 'uuid'],
            'servings' => ['required', 'numeric', 'gt:0', 'max:9999'],
            'waste_percent' => ['nullable', 'numeric', 'gte:0', 'max:100'],
            'lines' => ['present', 'array', 'max:200'],
            'lines.*.ingredient_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['nullable', 'numeric', 'gt:0', 'max:99999999.9999'],
            'lines.*.unit_id' => ['nullable', 'uuid'],
            'lines.*.unit_cost_amount' => ['nullable', 'numeric', 'gte:0', 'max:999999999999.999999'],
            'lines.*.cost_currency_code' => ['nullable', 'string', 'size:3'],
        ];
    }

    /**
     * @return array{
     *     recipe_id: string|null,
     *     servings: float|string,
     *     waste_percent: float|string|null,
     *     lines: list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null}>
     * }
     */
    public function draft(): array
    {
        /** @var array{recipe_id?: string|null, servings: float|string, waste_percent?: float|string|null, lines: list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null}>} $validated */
        $validated = $this->validated();

        return [
            'recipe_id' => isset($validated['recipe_id']) ? (string) $validated['recipe_id'] : null,
            'servings' => $validated['servings'],
            'waste_percent' => $validated['waste_percent'] ?? null,
            'lines' => $validated['lines'],
        ];
    }
}
