<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Healthy360\B2b\Services\QuotationOrderPlacer;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Where and when the accepted quotation is delivered — the three things the
 * order it places cannot be composed without. The placement itself checks the
 * address is the buyer's, the zone serves it, the window is offered there and
 * the day is not past its cut-off; this only checks the shape.
 */
class AcceptQuotationRequest extends FormRequest
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
            'customer_address_id' => ['required', 'uuid'],
            'requested_date' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'delivery_window_code' => ['required', 'string', 'max:40'],
            // A repeating quotation's run: one order a week, starting on `requested_date`.
            'repeat_weeks' => ['nullable', 'integer', 'min:1', 'max:'.QuotationOrderPlacer::MAX_WEEKS],
        ];
    }

    /**
     * @return array{customer_address_id: string, requested_date: string, delivery_window_code: string, repeat_weeks?: int|null}
     */
    public function delivery(): array
    {
        /** @var array{customer_address_id: string, requested_date: string, delivery_window_code: string, repeat_weeks?: int|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
