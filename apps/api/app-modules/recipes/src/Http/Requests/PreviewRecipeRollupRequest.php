<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Healthy360\Recipes\Enums\PackagingBasis;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

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

            /*
             * ── the draft's yield, and what it ships in ──────────────────────
             *
             * All optional, because the roll-up's older job — allergens and a
             * summed line total — needs none of them and every existing caller
             * sends none. Supplying the yield is what asks for the cost block:
             * every figure in it is some total *over* this number, so a request
             * without one gets `computed_cost: null` rather than a block of
             * dashes.
             *
             * The same bounds as `StoreRecipeRequest` and
             * `ReplaceRecipePackagingRequest`, which is not tidiness: a preview
             * that accepted a yield the save would refuse would show a cost for
             * a recipe that cannot be created.
             */
            'yield_quantity' => ['nullable', 'numeric', 'gt:0', 'max:99999999.9999'],
            'yield_unit_id' => ['nullable', 'uuid', 'required_with:yield_quantity'],
            'yield_piece_count' => ['nullable', 'integer', 'gt:0', 'max:100000'],
            'packaging_waste_percent' => ['nullable', 'numeric', 'gte:0', 'max:100'],
            'packaging' => ['sometimes', 'array', 'max:50'],
            'packaging.*.ingredient_id' => ['required', 'uuid'],
            'packaging.*.basis' => ['required', Rule::enum(PackagingBasis::class)],
            'packaging.*.quantity' => ['nullable', 'numeric', 'gt:0', 'max:99999999.9999'],
        ];
    }

    /**
     * @return array{
     *     recipe_id: string|null,
     *     servings: float|string,
     *     waste_percent: float|string|null,
     *     lines: list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null}>,
     *     yield_quantity: string|null,
     *     yield_unit_id: string|null,
     *     yield_piece_count: int|null,
     *     packaging_waste_percent: string|null,
     *     packaging: list<array{ingredient_id: string, basis: string, quantity?: float|string|null}>
     * }
     */
    public function draft(): array
    {
        /** @var array{recipe_id?: string|null, servings: float|string, waste_percent?: float|string|null, lines: list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null}>, yield_quantity?: float|string|null, yield_unit_id?: string|null, yield_piece_count?: int|null, packaging_waste_percent?: float|string|null, packaging?: list<array{ingredient_id: string, basis: string, quantity?: float|string|null}>} $validated */
        $validated = $this->validated();

        return [
            'recipe_id' => isset($validated['recipe_id']) ? (string) $validated['recipe_id'] : null,
            'servings' => $validated['servings'],
            'waste_percent' => $validated['waste_percent'] ?? null,
            'lines' => $validated['lines'],
            'yield_quantity' => isset($validated['yield_quantity']) ? (string) $validated['yield_quantity'] : null,
            'yield_unit_id' => isset($validated['yield_unit_id']) ? (string) $validated['yield_unit_id'] : null,
            'yield_piece_count' => isset($validated['yield_piece_count']) ? (int) $validated['yield_piece_count'] : null,
            'packaging_waste_percent' => isset($validated['packaging_waste_percent'])
                ? (string) $validated['packaging_waste_percent']
                : null,
            'packaging' => $validated['packaging'] ?? [],
        ];
    }
}
