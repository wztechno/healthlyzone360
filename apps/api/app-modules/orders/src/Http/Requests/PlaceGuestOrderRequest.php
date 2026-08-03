<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a guest checkout.
 *
 * **The same body as the authenticated `POST /orders`, deliberately.** A guest
 * checkout and a signed-in checkout differ in who the caller proved themselves
 * to be, not in what they are asking for, and they run through the same
 * `OrderPlacementService`. A second body shape for the same act would mean two
 * client code paths and two places for a field to be forgotten.
 *
 * **No `exists:` on either identifier, and the reason is the whole security
 * model of this endpoint.** A cart and an address must belong to *this
 * session's* customer account; a bare `exists` rule would happily accept
 * another guest's basket and then hand it to a service that refuses it for a
 * different reason, in a different shape, at a different status. The controller
 * loads both scoped to the account and answers `404` when either is not
 * theirs — one answer for "no such cart" and "not your cart", because the
 * distinction is only useful to somebody guessing identifiers.
 *
 * **Nothing about money, and nothing about the seller.** No total, no currency,
 * no organisation, no channel: every one of those is decided at placement from
 * the cart and the tariff standing at that moment (`OrderPlacementService`
 * reprices every line). A body that carried a total would be a number the
 * client had computed from a price it read earlier, and accepting it would make
 * the client the authority on what the kitchen charges.
 *
 * `requested_delivery_date` is a plain date, never a datetime. The order stores
 * a day; accepting an instant would invite a timezone argument nobody can win
 * about which day "2026-08-02T23:30:00Z" is.
 */
class PlaceGuestOrderRequest extends FormRequest
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
