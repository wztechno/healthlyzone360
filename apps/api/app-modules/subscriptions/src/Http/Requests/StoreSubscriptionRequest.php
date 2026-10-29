<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Validation for starting a standing arrangement.
 *
 * Two shapes are accepted:
 *
 * 1. **Integrator / test** — `sales_channel_id` + `plan_duration_id` (UUIDs).
 * 2. **Storefront** — `plan_duration_days` instead; the controller resolves the
 *    channel and duration the same way `GET /subscriptions/quote` does, because
 *    a shopper never holds those identifiers.
 *
 * `days` is the customer's meals for every delivery day the balance covers.
 * Whether the dates and sittings are the right ones is the service's question
 * — it knows the first delivery and the subscriber's sittings — and it answers
 * with `meals_missing` / `meals_incomplete` rather than a field error.
 */
class StoreSubscriptionRequest extends FormRequest
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
            'sales_channel_id' => ['required_without:plan_duration_days', 'uuid'],
            'branch_id' => ['nullable', 'uuid'],
            'catalogue_item_id' => ['required', 'uuid'],
            'catalogue_item_variant_id' => ['required', 'uuid'],
            'plan_duration_id' => ['required_without:plan_duration_days', 'uuid'],
            'plan_duration_days' => ['required_without:plan_duration_id', 'integer', 'min:1', 'max:366'],
            'customer_address_id' => ['required', 'uuid'],

            'weekdays' => ['required', 'array', 'min:1', 'max:7'],
            'weekdays.*' => ['integer', 'between:1,7'],

            'delivery_window_code' => ['nullable', 'string', 'max:40'],
            'no_substitutions' => ['nullable', 'boolean'],
            'start_from' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:today'],

            'days' => ['required', 'array', 'min:1', 'max:366'],
            'days.*.date' => ['required', 'date_format:Y-m-d', 'distinct'],
            'days.*.meals' => ['required', 'array', 'min:1', 'max:12'],
            'days.*.meals.*.slot' => ['required', 'string', 'in:breakfast,lunch,dinner,snack'],
            'days.*.meals.*.sequence' => ['nullable', 'integer', 'min:1', 'max:20'],
            'days.*.meals.*.catalogue_item_id' => ['required', 'uuid'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $hasIds = $this->filled('sales_channel_id') && $this->filled('plan_duration_id');
            $hasDays = $this->filled('plan_duration_days');

            if (! $hasIds && ! $hasDays) {
                $validator->errors()->add(
                    'plan_duration_days',
                    'Provide plan_duration_days (storefront) or sales_channel_id with plan_duration_id.',
                );
            }
        });
    }

    /**
     * @return array{
     *     sales_channel_id?: string,
     *     branch_id?: string|null,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string,
     *     plan_duration_id?: string,
     *     plan_duration_days?: int,
     *     customer_address_id: string,
     *     weekdays: list<int>,
     *     delivery_window_code?: string|null,
     *     no_substitutions?: bool|null,
     *     start_from?: string|null,
     *     days: list<array{date: string, meals: list<array{slot: string, sequence?: int|null, catalogue_item_id: string}>}>,
     * }
     */
    public function payload(): array
    {
        /** @var array{
         *     sales_channel_id?: string,
         *     branch_id?: string|null,
         *     catalogue_item_id: string,
         *     catalogue_item_variant_id: string,
         *     plan_duration_id?: string,
         *     plan_duration_days?: int,
         *     customer_address_id: string,
         *     weekdays: list<int>,
         *     delivery_window_code?: string|null,
         *     no_substitutions?: bool|null,
         *     start_from?: string|null,
         *     days: list<array{date: string, meals: list<array{slot: string, sequence?: int|null, catalogue_item_id: string}>}>,
         * } $validated
         */
        $validated = $this->validated();

        return $validated;
    }
}
