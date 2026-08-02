<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Requests;

use Healthy360\Pricing\Enums\CustomerScope;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for creating a price list.
 *
 * `status` is absent for the §4.15 reason: activation and archiving are POST
 * sub-resource actions with their own permission and their own audit events. A
 * new list is always a draft — one created active would be pricing customers
 * before anybody had entered a price.
 *
 * `currency_code` is required and has no default. Falling back to the
 * organisation's default currency would be the kind of helpfulness that
 * produces a USD tariff in an AED kitchen and no way to tell whether anybody
 * meant it.
 */
class StorePriceListRequest extends FormRequest
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
            'currency_code' => ['required', 'string', 'size:3'],
            'customer_scope' => ['nullable', new Enum(CustomerScope::class)],
            'branch_id' => ['nullable', 'uuid'],
            'valid_from' => ['nullable', 'date_format:Y-m-d'],
            'valid_to' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * @return array{code: string, name_en: string, name_ar?: string|null, currency_code: string, customer_scope?: string|null, branch_id?: string|null, valid_from?: string|null, valid_to?: string|null}
     */
    public function payload(): array
    {
        /** @var array{code: string, name_en: string, name_ar?: string|null, currency_code: string, customer_scope?: string|null, branch_id?: string|null, valid_from?: string|null, valid_to?: string|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
