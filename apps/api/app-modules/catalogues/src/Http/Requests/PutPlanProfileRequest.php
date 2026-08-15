<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Healthy360\Catalogues\Enums\PlanPricingBasis;
use Healthy360\Catalogues\Enums\PlanType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for a plan's commercial terms.
 *
 * Every field is optional and the omitted ones take their documented defaults —
 * `both`, `per_day`, skippable, pausable, 24 hours — because this is a PUT of a
 * whole small document rather than a patch of a large one, and a client that
 * sends `{}` is legitimately saying "the ordinary terms".
 *
 * `change_cutoff_hours` accepts `0`. "A subscriber may change a delivery until
 * the van leaves" is a policy somebody may genuinely have, and `min:1` would
 * make it unsayable.
 */
class PutPlanProfileRequest extends FormRequest
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
            'plan_type' => ['nullable', new Enum(PlanType::class)],
            'pricing_basis' => ['nullable', new Enum(PlanPricingBasis::class)],
            'allows_free_selection' => ['nullable', 'boolean'],
            'skip_allowed' => ['nullable', 'boolean'],
            'pause_allowed' => ['nullable', 'boolean'],
            'change_cutoff_hours' => ['nullable', 'integer', 'min:0', 'max:720'],
            'summary_en' => ['nullable', 'string', 'max:2000'],
            'summary_ar' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function profile(): array
    {
        /** @var array<string, mixed> */
        return $this->validated();
    }
}
