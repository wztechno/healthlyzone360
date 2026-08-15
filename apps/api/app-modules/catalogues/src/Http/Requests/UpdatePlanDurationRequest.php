<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Healthy360\Catalogues\Enums\PlanDurationKind;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for an edit to a plan duration.
 *
 * `duration_days` accepts an explicit `null` — that is how a fixed run becomes
 * a one-off — and the kind/days correspondence is applied to the merged row in
 * the service.
 */
class UpdatePlanDurationRequest extends FormRequest
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
            'duration_kind' => ['sometimes', new Enum(PlanDurationKind::class)],
            'duration_days' => ['sometimes', 'nullable', 'integer', 'gt:0', 'max:3650'],
            'name_en' => ['sometimes', 'string', 'max:255'],
            'name_ar' => ['sometimes', 'string', 'max:255'],
            'display_order' => ['sometimes', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'duration_days.gt' => 'A duration of zero days is not a subscription — use the one-off kind for a single purchase.',
            'duration_kind.enum' => 'A duration is either a one-off purchase or a fixed run of days.',
        ];
    }
}
