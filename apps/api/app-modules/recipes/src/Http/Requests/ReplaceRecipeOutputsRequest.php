<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of what a version produces
 * (master plan v2 §4.2).
 *
 * The exactly-one-primary rule lives in the service rather than here: it is a
 * statement about the set as a whole, and the service is also where the
 * duplicate-ingredient check and the tenant-visibility check happen. One place
 * decides, so there is one answer.
 */
class ReplaceRecipeOutputsRequest extends FormRequest
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
            'outputs' => ['present', 'array', 'max:20'],
            'outputs.*.ingredient_id' => ['required', 'uuid'],
            'outputs.*.output_quantity' => ['required', 'numeric', 'gt:0', 'max:99999999.9999'],
            'outputs.*.unit_id' => ['required', 'uuid'],
            'outputs.*.is_primary' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return list<array{ingredient_id: string, output_quantity: float|string, unit_id: string, is_primary?: bool}>
     */
    public function outputs(): array
    {
        /** @var list<array{ingredient_id: string, output_quantity: float|string, unit_id: string, is_primary?: bool}> $outputs */
        $outputs = $this->validated('outputs') ?? [];

        return $outputs;
    }
}
