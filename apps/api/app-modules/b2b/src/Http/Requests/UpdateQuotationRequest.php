<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Patching a draft (B4). `lines`, when present, is the desired **complete**
 * set — the same PUT-shaped-as-PATCH convention `PriceEntryService::replace()`
 * uses for a price list's entries — so a client sends every line it wants
 * kept, not a delta.
 */
class UpdateQuotationRequest extends FormRequest
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
            'notes' => ['nullable', 'string', 'max:2000'],
            'lines' => ['nullable', 'array'],
            'lines.*.catalogue_item_id' => ['required', 'uuid'],
            'lines.*.catalogue_item_variant_id' => ['nullable', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'gt:0'],
            'lines.*.note' => ['nullable', 'string', 'max:255'],
        ];
    }

    /**
     * @return array{notes?: string|null, lines?: list<array<string, mixed>>|null}
     */
    public function payload(): array
    {
        /** @var array{notes?: string|null, lines?: list<array<string, mixed>>|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
