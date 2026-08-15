<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for editing an address in place.
 *
 * Two fields are missing on purpose, and both would be quietly wrong rather
 * than merely unsupported.
 *
 * **`address_type`.** The service checks the served-area rule against the type
 * the address *has* and then writes the attributes it was given; a body that
 * carried a new type would be checked under the old rule and stored under the
 * new one, so a billing address in an unserved city could become a delivery
 * address nothing can reach. Changing what an address is for is a new address.
 *
 * **`is_default`.** Promotion means demoting the incumbent, and the two writes
 * have to be one transaction because the partial unique index refuses a second
 * default. An update forcefills columns, so accepting it here would leave the
 * account with two defaults or none. `POST /me/addresses/{address}/default` is
 * the transaction that does it properly.
 *
 * `delivery_area_id` *is* accepted: moving house is the ordinary case, and the
 * service re-checks coverage before it writes.
 */
class UpdateAddressRequest extends FormRequest
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
            'delivery_area_id' => ['sometimes', 'required', 'uuid'],
            'label' => ['sometimes', 'nullable', 'string', 'max:60'],
            'line_one' => ['sometimes', 'required', 'string', 'max:255'],
            'line_two' => ['sometimes', 'nullable', 'string', 'max:255'],
            'building' => ['sometimes', 'nullable', 'string', 'max:120'],
            'floor' => ['sometimes', 'nullable', 'string', 'max:40'],
            'apartment' => ['sometimes', 'nullable', 'string', 'max:40'],
            'directions' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'postal_code' => ['sometimes', 'nullable', 'string', 'max:20'],
            'contact_point_id' => ['sometimes', 'nullable', 'uuid'],
        ];
    }

    /**
     * @return array<string, string|null>
     */
    public function payload(): array
    {
        /** @var array<string, string|null> $validated */
        $validated = $this->validated();

        return $validated;
    }
}
