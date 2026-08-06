<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A buyer drafting a new quotation against a programme (B4). `lines` is
 * optional here — a buyer may open an empty draft and add lines with a
 * later PATCH — but when present it is validated the same way
 * `QuotationService::writeLines()` validates a PATCH's replacement set.
 */
class CreateQuotationRequest extends FormRequest
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
            'lines' => ['nullable', 'array', 'min:1'],
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
