<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for creating a delivery zone.
 *
 * `status` is absent for the §4.15 reason: archiving is a POST sub-resource
 * action with its own audit event, and suspension is `is_active` on the
 * update. A new zone is always active — a zone created suspended would be a
 * map nobody could use and nothing would explain why.
 *
 * `currency_code` is optional here, unlike on a price list. A list is a
 * commercial instrument whose currency decides what hundreds of numbers mean,
 * so guessing it would be dangerous; a zone carries at most two amounts in the
 * kitchen's home market, and making every zone restate the currency of the
 * country it is in would be ceremony. The service falls back to the
 * organisation's default and an explicit value still wins.
 */
class StoreDeliveryZoneRequest extends FormRequest
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
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['nullable', 'string', 'max:255'],
            'currency_code' => ['nullable', 'string', 'size:3'],
            'branch_id' => ['nullable', 'uuid'],
            'delivery_fee_minor' => ['nullable', 'integer', 'min:0'],
            'minimum_order_minor' => ['nullable', 'integer', 'min:0'],
            'estimated_minutes' => ['nullable', 'integer', 'min:1'],
        ];
    }

    /**
     * @return array{code: string, name_en: string, name_ar?: string|null, currency_code?: string|null, branch_id?: string|null, delivery_fee_minor?: int|null, minimum_order_minor?: int|null, estimated_minutes?: int|null}
     */
    public function payload(): array
    {
        /** @var array{code: string, name_en: string, name_ar?: string|null, currency_code?: string|null, branch_id?: string|null, delivery_fee_minor?: int|null, minimum_order_minor?: int|null, estimated_minutes?: int|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
