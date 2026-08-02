<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Healthy360\Catalogues\Enums\PlanDurationKind;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for a new plan duration.
 *
 * `duration_days` is `nullable` here and its **correspondence with
 * `duration_kind`** is the service's job, because the PATCH has to apply the
 * same rule to a merged row. What this layer does is refuse the shapes that are
 * wrong whatever the kind: a non-integer, and — pointedly — **zero**. Zero is
 * the sentinel §4.3 removed, and the message says so rather than reporting a
 * range violation, because the client sending it is following the old
 * convention and needs to be told that it is gone.
 */
class StorePlanDurationRequest extends FormRequest
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
            'code' => ['required', 'string', 'max:40'],
            'duration_kind' => ['required', new Enum(PlanDurationKind::class)],
            'duration_days' => ['nullable', 'integer', 'gt:0', 'max:3650'],
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['nullable', 'string', 'max:255'],
            'display_order' => ['nullable', 'integer', 'min:0'],
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
