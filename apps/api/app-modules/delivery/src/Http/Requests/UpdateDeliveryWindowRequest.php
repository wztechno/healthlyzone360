<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for editing a delivery window.
 *
 * `code` is refused by the service rather than stripped here, matching every
 * other vocabulary in this programme.
 *
 * The pairing and ordering rules run against the **merged** row: sending only
 * `ends_at` compares it with the stored `starts_at`, so a client moving one end
 * of a window does not have to restate the other. Turning a timed window back
 * into an untimed one therefore means sending both as `null`.
 */
class UpdateDeliveryWindowRequest extends FormRequest
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
            'name_en' => ['sometimes', 'string', 'max:255'],
            'name_ar' => ['sometimes', 'nullable', 'string', 'max:255'],
            'starts_at' => ['sometimes', 'nullable', 'date_format:H:i,H:i:s'],
            'ends_at' => ['sometimes', 'nullable', 'date_format:H:i,H:i:s'],
            'weekdays' => ['sometimes', 'nullable', 'array', 'max:7'],
            'weekdays.*' => ['integer', 'between:1,7'],
            'display_order' => ['sometimes', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * The validated body **plus** the field the rules refuse to describe, so
     * the service can reject it explicitly.
     *
     * @return array<string, mixed>
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        if ($this->has('code')) {
            $validated['code'] = $this->input('code');
        }

        return $validated;
    }
}
