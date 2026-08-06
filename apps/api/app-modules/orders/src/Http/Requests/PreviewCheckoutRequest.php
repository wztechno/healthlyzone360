<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for pricing a basket before it is placed.
 *
 * **`customer_address_id` is optional, and that is the one field this request
 * disagrees with `StoreOrderRequest` about.** A shopper previews a total
 * before they have chosen where it goes — the cart screen has no address at
 * all — and a preview that demanded one would have nothing to answer with
 * until the checkout form is half filled in. `CheckoutPreviewService` treats
 * its absence as a fact worth reporting (`address_missing`) rather than a
 * validation failure.
 *
 * Otherwise the same shape as placement, and for the same reasons: no total in
 * the body — the server prices, never accepts a client's number — and
 * `requested_delivery_date` may still disagree with the basket's own lines,
 * which the preview reports rather than resolves.
 */
class PreviewCheckoutRequest extends FormRequest
{
    /**
     * Authorisation is the caller owning the cart (and the address, when one is
     * named), checked by `OrderLocator` once both identifiers are read. A form
     * request that also guessed would give two answers to one question.
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
            'cart_id' => ['required', 'uuid'],
            'customer_address_id' => ['nullable', 'uuid'],
            'delivery_window_code' => ['nullable', 'string', 'max:40'],
            'requested_delivery_date' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * @return array{cart_id: string, customer_address_id?: string|null, delivery_window_code?: string|null, requested_delivery_date?: string|null}
     */
    public function payload(): array
    {
        /** @var array{cart_id: string, customer_address_id?: string|null, delivery_window_code?: string|null, requested_delivery_date?: string|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
