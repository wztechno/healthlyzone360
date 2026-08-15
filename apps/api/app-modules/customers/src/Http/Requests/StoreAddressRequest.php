<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Requests;

use Healthy360\Customers\Enums\CustomerAddressType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for adding an address to the caller's own account.
 *
 * `delivery_area_id` is a `uuid` and nothing more. Whether anybody actually
 * delivers to that area is asked at save time, through the `AreaServiceLookup`
 * port, and answered as `address.area_not_served` — a 422 that names the real
 * problem. An `exists` rule here would refuse an unknown identifier with
 * "invalid" and would still say nothing about coverage, which is the question
 * the person is really asking.
 *
 * The distinction matters because the rule is not the same for both types: a
 * billing address goes wherever the customer says, and applying the delivery
 * check to it would refuse a perfectly good invoice address in a city no
 * kitchen reaches.
 *
 * `is_default` is accepted here but not on update. Setting it means demoting
 * the incumbent, and that pair of writes has to be one transaction — the
 * partial unique index means a caller doing it in two statements would collide
 * with itself. Creation goes through the service, which does exactly that;
 * an update forcefills columns and would leave two defaults, so promotion has
 * its own endpoint.
 */
class StoreAddressRequest extends FormRequest
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
            'address_type' => ['required', new Enum(CustomerAddressType::class)],
            'delivery_area_id' => ['required', 'uuid'],
            'label' => ['nullable', 'string', 'max:60'],
            'line_one' => ['required', 'string', 'max:255'],
            'line_two' => ['nullable', 'string', 'max:255'],
            'building' => ['nullable', 'string', 'max:120'],
            'floor' => ['nullable', 'string', 'max:40'],
            'apartment' => ['nullable', 'string', 'max:40'],
            'directions' => ['nullable', 'string', 'max:1000'],
            'postal_code' => ['nullable', 'string', 'max:20'],
            'contact_point_id' => ['nullable', 'uuid'],
            'is_default' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return array{
     *     address_type: string,
     *     delivery_area_id: string,
     *     label?: string|null,
     *     line_one: string,
     *     line_two?: string|null,
     *     building?: string|null,
     *     floor?: string|null,
     *     apartment?: string|null,
     *     directions?: string|null,
     *     postal_code?: string|null,
     *     contact_point_id?: string|null,
     *     is_default?: bool|null
     * }
     */
    public function payload(): array
    {
        /**
         * @var array{
         *     address_type: string,
         *     delivery_area_id: string,
         *     label?: string|null,
         *     line_one: string,
         *     line_two?: string|null,
         *     building?: string|null,
         *     floor?: string|null,
         *     apartment?: string|null,
         *     directions?: string|null,
         *     postal_code?: string|null,
         *     contact_point_id?: string|null,
         *     is_default?: bool|null
         * } $validated
         */
        $validated = $this->validated();

        return $validated;
    }
}
