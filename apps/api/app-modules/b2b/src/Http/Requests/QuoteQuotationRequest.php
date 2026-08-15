<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The kitchen (or platform, on its behalf) naming a price for every line of
 * a submitted quotation (B4). `QuotationService::quote()` is what actually
 * enforces "every line, never fewer, never more" — this request only checks
 * the shape of what was sent.
 */
class QuoteQuotationRequest extends FormRequest
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
            'prices' => ['required', 'array', 'min:1'],
            'prices.*.quotation_line_id' => ['required', 'uuid'],
            'prices.*.unit_amount_minor' => ['required', 'integer', 'min:0'],
        ];
    }

    /**
     * @return list<array{quotation_line_id: string, unit_amount_minor: int}>
     */
    public function payload(): array
    {
        /** @var array{prices: list<array{quotation_line_id: string, unit_amount_minor: int}>} $validated */
        $validated = $this->validated();

        return $validated['prices'];
    }
}
