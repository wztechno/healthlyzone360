<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of a plan's duration assignments.
 *
 * `discount_percent` is `nullable` and has **no default**. That is the whole
 * point of the field: an absent or null value means "nobody has stated a
 * discount", which the service stores as NULL and the presenter serves as null.
 * A `0` sent explicitly is a different statement and is stored as `0.00`.
 *
 * The exclusive upper bound is `lt:100`: a hundred per cent off is free, which
 * is a decision to make with a price of zero rather than with a discount, and
 * anything above it is arithmetic nobody meant.
 */
class ReplacePlanVariantDurationsRequest extends FormRequest
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
            'assignments' => ['present', 'array', 'max:500'],
            'assignments.*.catalogue_item_variant_id' => ['nullable', 'uuid'],
            'assignments.*.variant_code' => ['nullable', 'string', 'max:60'],
            'assignments.*.plan_duration_id' => ['nullable', 'uuid'],
            'assignments.*.duration_code' => ['nullable', 'string', 'max:40'],
            'assignments.*.discount_percent' => ['nullable', 'numeric', 'min:0', 'lt:100'],
            'assignments.*.is_available' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function assignments(): array
    {
        /** @var list<array<string, mixed>> $assignments */
        $assignments = $this->validated('assignments') ?? [];

        return $assignments;
    }
}
