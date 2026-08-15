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
 * **Costs (K1.3).** `unit_cost_amount` and `cost_currency_code` are accepted
 * per line and are the only way costs enter the system outside the importer.
 * `line_cost_amount` is **not** accepted: it is quantity × unit cost, the
 * service derives it, and a derived value a client can supply is a derived
 * value that can disagree with its inputs (appendix C).
 *
 * Whether the caller may write a cost at all is not a validation question — it
 * is `recipe.view_costs_organisation`, checked in the service, because the
 * same permission also governs *erasing* a cost by replacing a costed set
 * without one.
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

            // `gte:0`, not `gt:0`: a donated or self-produced input costs
            // nothing, and recording that is not the same as recording
            // nothing. The bound is what `decimal(18,6)` holds.
            'lines.*.unit_cost_amount' => ['nullable', 'numeric', 'gte:0', 'max:999999999999.999999'],

            // Existence is checked in the service against the currencies
            // table, for the same reason the ingredient is.
            'lines.*.cost_currency_code' => ['nullable', 'string', 'size:3'],
            'lines.*.source_designation' => ['nullable', 'string', 'max:160'],
            'lines.*.comment' => ['nullable', 'string', 'max:255'],
        ];
    }

    /**
     * @return list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null, source_designation?: string|null, comment?: string|null}>
     */
    public function lines(): array
    {
        /** @var list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null, source_designation?: string|null, comment?: string|null}> $lines */
        $lines = $this->validated('lines') ?? [];

        return $lines;
    }
}
