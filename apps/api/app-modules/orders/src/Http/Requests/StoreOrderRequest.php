<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for turning a basket into an order.
 *
 * **Four fields, and none of them is a price.** Every amount on the order is
 * decided by `OrderPlacementService`, which reprices every line at placement
 * against the tariff standing at that moment. A body that could state a total
 * would be a client quoting the server its own prices, and the first thing
 * anybody would do with it is quote a lower one. The cart's probe prices are
 * advisory and were never stored, for the same reason.
 *
 * `cart_id` rather than an implicit "your open cart on this channel". The
 * customer may hold one basket per channel, and a checkout that guessed which
 * one it meant would place the wrong order for anybody shopping two kitchens.
 * The identifier is scoped to the caller by `OrderLocator` before the service
 * ever sees it.
 *
 * `requested_delivery_date` is optional and **may contradict the basket**. The
 * lines can name a day of their own, an explicit date wins, and a disagreement
 * is `mixed_delivery_dates` rather than a silent preference — this phase's
 * order carries exactly one delivery date, and flattening two would deliver
 * Wednesday's food on Monday.
 *
 * `delivery_window_code` is a code rather than an identifier because a window
 * is chosen from a list a customer reads ("evening"), and it is **not**
 * validated against the kitchen's windows here: whether that slot is offered on
 * that day by that branch is a scheduling question the placement service asks
 * with the cut-off rules in hand.
 *
 * There is no `payment_method`. There is one, it happens at the door, and an
 * accepted field with one legal value is a field that promises a choice the
 * platform cannot honour.
 */
class StoreOrderRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request
     * that also guessed would give two answers to one question.
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
            // No `exists:` rules, the K1.2 reason at its sharpest: both rows
            // must belong to *this customer*, and a bare rule would happily
            // accept somebody else's basket or somebody else's address —
            // which for an address is a confidential row being named by a
            // stranger. `OrderLocator` scopes both and answers 404.
            'cart_id' => ['required', 'uuid'],
            'customer_address_id' => ['required', 'uuid'],
            'delivery_window_code' => ['nullable', 'string', 'max:40'],
            'requested_delivery_date' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * @return array{cart_id: string, customer_address_id: string, delivery_window_code?: string|null, requested_delivery_date?: string|null}
     */
    public function payload(): array
    {
        /** @var array{cart_id: string, customer_address_id: string, delivery_window_code?: string|null, requested_delivery_date?: string|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
