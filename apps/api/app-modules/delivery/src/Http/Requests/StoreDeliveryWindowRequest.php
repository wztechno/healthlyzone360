<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for creating a delivery window.
 *
 * The times are matched against `H:i` or `H:i:s` here and re-checked in the
 * service, which is where the pairing rule ("both or neither") and the
 * ordering rule live: those are statements about the row as a whole, not about
 * one field, and a message that says which half is missing is worth more than
 * a per-field regex failure.
 *
 * `weekdays` is a list of ISO numbers and **an empty list means every day**.
 * It is not nullable, because "unset" and "unrestricted" would be the same
 * fact wearing two encodings.
 */
class StoreDeliveryWindowRequest extends FormRequest
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
            'code' => ['required', 'string', 'max:30'],
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['nullable', 'string', 'max:255'],
            'starts_at' => ['nullable', 'date_format:H:i,H:i:s'],
            'ends_at' => ['nullable', 'date_format:H:i,H:i:s'],
            'weekdays' => ['nullable', 'array', 'max:7'],
            'weekdays.*' => ['integer', 'between:1,7'],
            'display_order' => ['nullable', 'integer', 'min:0'],
            'is_active' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return array{code: string, name_en: string, name_ar?: string|null, starts_at?: string|null, ends_at?: string|null, weekdays?: list<int>|null, display_order?: int|null, is_active?: bool|null}
     */
    public function payload(): array
    {
        /** @var array{code: string, name_en: string, name_ar?: string|null, starts_at?: string|null, ends_at?: string|null, weekdays?: list<int>|null, display_order?: int|null, is_active?: bool|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
