<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for changing which slot the food arrives in.
 *
 * `delivery_window_code` is **present and nullable**, which is the difference
 * between "no preference" and "leave it alone". A `PUT` replaces the field
 * whole, so an absent key would be ambiguous; `{"delivery_window_code": null}`
 * is how a customer says they no longer mind, and `required` with `nullable`
 * is the pair of rules that makes both expressible.
 *
 * A code rather than an identifier, because a window is chosen from a list a
 * customer reads ("evening") — the same choice `StoreOrderRequest` makes. It is
 * deliberately not validated against the kitchen's configured windows here:
 * which slots a branch offers on which weekdays is scheduling data, it changes
 * without reference to standing subscriptions, and an `exists` rule would turn
 * a kitchen retiring a slot into a validation failure on every subscriber's
 * next edit of an unrelated field.
 */
class UpdateSubscriptionWindowRequest extends FormRequest
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
            'delivery_window_code' => ['present', 'nullable', 'string', 'max:40'],
        ];
    }
}
