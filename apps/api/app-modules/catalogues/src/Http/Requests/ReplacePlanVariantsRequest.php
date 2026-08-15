<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Healthy360\Catalogues\Enums\ServiceTier;
use Healthy360\Catalogues\Enums\VariantStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for a full replacement of a plan's configuration matrix.
 *
 * `cells` is `present`, not `required`: an empty array is the legitimate
 * statement "this plan offers no configurations yet", which archives every one
 * it had, and `required` would reject it as if the field had been forgotten.
 *
 * `variant_type` is not a field and never will be — it is derived from the
 * item's own type (appendix C). Neither is `catalogue_item_id`: the plan is in
 * the URL, and a body that could disagree with it would eventually be made to.
 *
 * `code` is optional, and omitting it is the ordinary case: the server derives
 * a deterministic one from the cell's own coordinates, so a 4 × 2 × 5 matrix
 * does not need forty hand-typed identifiers.
 */
class ReplacePlanVariantsRequest extends FormRequest
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
            'cells' => ['present', 'array', 'max:200'],
            'cells.*.code' => ['nullable', 'string', 'max:60'],
            'cells.*.name_en' => ['nullable', 'string', 'max:255'],
            'cells.*.name_ar' => ['nullable', 'string', 'max:255'],
            'cells.*.status' => ['nullable', new Enum(VariantStatus::class)],
            'cells.*.meal_combination_option_id' => ['required', 'uuid'],
            'cells.*.energy_band_id' => ['nullable', 'uuid'],
            'cells.*.service_tier' => ['nullable', new Enum(ServiceTier::class)],
            'cells.*.includes_snacks' => ['nullable', 'boolean'],
            'cells.*.meals_per_day' => ['required', 'integer', 'gt:0', 'max:12'],
            'cells.*.snacks_per_day' => ['nullable', 'integer', 'min:0', 'max:12'],
        ];
    }

    /**
     * @return list<array{
     *     meal_combination_option_id: string,
     *     service_tier?: string|null,
     *     energy_band_id?: string|null,
     *     includes_snacks?: bool|null,
     *     meals_per_day: int|string,
     *     snacks_per_day?: int|string|null,
     *     code?: string|null,
     *     name_en?: string|null,
     *     name_ar?: string|null,
     *     status?: string|null
     * }>
     */
    public function cells(): array
    {
        /** @var list<array{meal_combination_option_id: string, service_tier?: string|null, energy_band_id?: string|null, includes_snacks?: bool|null, meals_per_day: int|string, snacks_per_day?: int|string|null, code?: string|null, name_en?: string|null, name_ar?: string|null, status?: string|null}> $cells */
        $cells = $this->validated('cells') ?? [];

        return $cells;
    }
}
