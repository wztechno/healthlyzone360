<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of a meal's per-day availability.
 */
class ReplaceCatalogueItemAvailabilityRequest extends FormRequest
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
            'days' => ['present', 'array', 'max:366'],
            'days.*.date' => ['required', 'date_format:Y-m-d'],
            'days.*.is_available' => ['required', 'boolean'],
            'days.*.remaining' => ['nullable', 'integer', 'min:0'],
            'days.*.order_cut_off_at' => ['nullable', 'date_format:H:i,H:i:s'],
        ];
    }

    /**
     * @return list<array{date: string, is_available: bool, remaining?: int|null, order_cut_off_at?: string|null}>
     */
    public function days(): array
    {
        /** @var list<array{date: string, is_available: bool, remaining?: int|null, order_cut_off_at?: string|null}> $days */
        $days = $this->validated('days') ?? [];

        return $days;
    }
}
