<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of a version's method.
 *
 * `instruction_ar` is nullable while `instruction_en` is not: a kitchen writes
 * the method it works in first, and blocking a draft on a translation nobody
 * has written would only produce machine translation, which the master plan
 * forbids for text a person acts on (§4.18).
 */
class ReplaceRecipeStepsRequest extends FormRequest
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
            'steps' => ['present', 'array', 'max:100'],
            'steps.*.instruction_en' => ['required', 'string', 'max:4000'],
            'steps.*.instruction_ar' => ['nullable', 'string', 'max:4000'],
            'steps.*.minutes' => ['nullable', 'integer', 'min:0', 'max:10000'],
        ];
    }

    /**
     * @return list<array{instruction_en: string, instruction_ar?: string|null, minutes?: int|null}>
     */
    public function steps(): array
    {
        /** @var list<array{instruction_en: string, instruction_ar?: string|null, minutes?: int|null}> $steps */
        $steps = $this->validated('steps') ?? [];

        return $steps;
    }
}
