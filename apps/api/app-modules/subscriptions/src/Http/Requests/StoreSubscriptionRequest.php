<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for starting a standing arrangement.
 *
 * **Checkout-shaped, and deliberately so.** The same three coordinates a plan
 * is sold on — the plan, the configuration cell, the duration — plus everything
 * a delivery needs. `NewSubscription` is the value object behind it, and the
 * shapes agree field for field so that the console command standing a test
 * world up and this endpoint are building the same thing.
 *
 * **No price fields, the `StoreOrderRequest` rule.** Every amount is decided by
 * `SubscriptionPricing` at the moment of purchase and captured onto the row; a
 * body that could state a per-day price would be a client quoting the server
 * its own prices, and the first thing anybody would do with it is quote a lower
 * one. `GET /subscriptions/quote` is how a client shows the number *before*
 * committing, and it resolves it the same way.
 *
 * **No `exists:` rules on the two identifiers that must be the caller's own.**
 * `customer_address_id` is scoped to the caller by `SubscriptionLocator`, and a
 * bare `exists` would happily accept a stranger's address — a confidential row
 * being named by somebody who does not hold it. The catalogue identifiers are
 * checked by `SubscriptionService` against the *channel's* organisation, which
 * a validation rule cannot see, and their refusals are the structured reasons a
 * client renders.
 *
 * `weekdays` is ISO — 1 = Monday … 7 = Sunday — and must not be empty. The
 * table's own CHECK says so and the service refuses it with a sentence first;
 * the rule here is what turns a typo into a field error rather than a 409.
 *
 * `start_from` is a *request* rather than a promise: the service moves it
 * forward to the first weekday the subscription actually delivers on that is
 * still outside the plan's change window, because a first delivery already
 * inside its own cut-off would be an order the customer could never have
 * changed. `after_or_equal:today` keeps a client from asking for last Tuesday.
 */
class StoreSubscriptionRequest extends FormRequest
{
    /**
     * Authorisation here is **ownership**, resolved in the controller, exactly
     * as the rest of the customer journey works: a customer is a member of no
     * organisation, so there is no permission code to check and nothing for one
     * to be scoped to.
     */
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
            'sales_channel_id' => ['required', 'uuid'],
            'branch_id' => ['nullable', 'uuid'],
            'catalogue_item_id' => ['required', 'uuid'],
            'catalogue_item_variant_id' => ['required', 'uuid'],
            'plan_duration_id' => ['required', 'uuid'],
            'customer_address_id' => ['required', 'uuid'],

            'weekdays' => ['required', 'array', 'min:1', 'max:7'],
            'weekdays.*' => ['integer', 'between:1,7'],

            'delivery_window_code' => ['nullable', 'string', 'max:40'],
            'no_substitutions' => ['nullable', 'boolean'],
            'start_from' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:today'],
        ];
    }

    /**
     * @return array{
     *     sales_channel_id: string,
     *     branch_id?: string|null,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string,
     *     plan_duration_id: string,
     *     customer_address_id: string,
     *     weekdays: list<int>,
     *     delivery_window_code?: string|null,
     *     no_substitutions?: bool|null,
     *     start_from?: string|null,
     * }
     */
    public function payload(): array
    {
        /** @var array{
         *     sales_channel_id: string,
         *     branch_id?: string|null,
         *     catalogue_item_id: string,
         *     catalogue_item_variant_id: string,
         *     plan_duration_id: string,
         *     customer_address_id: string,
         *     weekdays: list<int>,
         *     delivery_window_code?: string|null,
         *     no_substitutions?: bool|null,
         *     start_from?: string|null,
         * } $validated
         */
        $validated = $this->validated();

        return $validated;
    }
}
