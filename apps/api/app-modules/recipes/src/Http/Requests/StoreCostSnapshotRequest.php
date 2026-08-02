<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Healthy360\Recipes\Enums\CostBasis;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for "cost this version now".
 *
 * `basis` is required and may only be `recalculated`. `as_recorded` is a real
 * value of the column and is deliberately **not** accepted here: it means
 * "this is what a source technical sheet stated", and the only thing that
 * holds a source sheet is the K1.8 importer. An endpoint that accepted it
 * would let somebody type figures in and have them stored as evidence of a
 * document that was never read — which is exactly the provenance the two-basis
 * design exists to keep straight.
 *
 * No amounts in the body at all. Every figure on a `recalculated` snapshot is
 * derived from the version's lines and yield, and a derived value a client can
 * supply is a derived value that can disagree with its inputs (appendix C).
 */
class StoreCostSnapshotRequest extends FormRequest
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
            'basis' => ['required', 'string', 'in:'.CostBasis::Recalculated->value],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'basis.in' => 'Only a recalculated basis can be requested here. An as-recorded snapshot states what a source technical sheet said, and only the importer reads one.',
        ];
    }

    public function basis(): CostBasis
    {
        return CostBasis::from((string) $this->validated('basis'));
    }
}
