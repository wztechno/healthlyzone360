<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for giving a desk-provisioned customer somewhere to receive food.
 *
 * The self-service body (`AddCustomerAddressRequest`) minus two fields, and both
 * absences are decisions rather than omissions.
 *
 * **No `address_type`.** The desk adds delivery addresses. A billing address is
 * an invoicing arrangement a corporate buyer makes, not something a person
 * dictates over a telephone while ordering lunch, and offering the choice would
 * let an agent silently create an address the checkout will never find.
 *
 * **No `contact_point_id`.** On the self-service form it names "the number the
 * driver calls" out of the caller's *own* contacts, and the caller is the only
 * person who could know which. Here it would be an identifier the desk supplied
 * for a `contact_points` row this endpoint cannot prove belongs to this account —
 * a foreign key the database would accept and nobody had checked. The number the
 * kitchen holds is already the account's primary, written when the customer was.
 *
 * `is_default` is likewise absent, and does not need to be present:
 * `CustomerAddressService` makes the **first** address of a type the default
 * whether or not it was asked for, and a desk-provisioned customer's first
 * address is the one being added here.
 *
 * `delivery_area_id` is a `uuid` and nothing more. Whether anybody actually
 * delivers to that area is asked at save time through the `AreaServiceLookup`
 * port and answered as `address.area_not_served` — a 422 naming the real
 * problem, which is what the agent has to read out to the customer. An `exists`
 * rule here would refuse an unknown identifier as "invalid" and would still say
 * nothing about coverage.
 *
 * Every length matches the column, copied from `StoreAddressRequest` rather than
 * re-derived: two request classes writing the same table through the same
 * service must not disagree about how long a floor number may be.
 */
class StoreOrderDeskCustomerAddressRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware plus the controller's
     * scoping check; a form request that also guessed would give a third answer
     * to one question.
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
            'delivery_area_id' => ['required', 'uuid'],
            'label' => ['nullable', 'string', 'max:60'],
            'line_one' => ['required', 'string', 'max:255'],
            'line_two' => ['nullable', 'string', 'max:255'],
            'building' => ['nullable', 'string', 'max:120'],
            'floor' => ['nullable', 'string', 'max:40'],
            'apartment' => ['nullable', 'string', 'max:40'],
            'directions' => ['nullable', 'string', 'max:1000'],
            'postal_code' => ['nullable', 'string', 'max:20'],
        ];
    }

    /**
     * @return array{
     *     delivery_area_id: string,
     *     label: string|null,
     *     line_one: string,
     *     line_two: string|null,
     *     building: string|null,
     *     floor: string|null,
     *     apartment: string|null,
     *     directions: string|null,
     *     postal_code: string|null
     * }
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        return [
            'delivery_area_id' => (string) $validated['delivery_area_id'],
            'label' => $this->stated($validated['label'] ?? null),
            'line_one' => (string) $validated['line_one'],
            'line_two' => $this->stated($validated['line_two'] ?? null),
            'building' => $this->stated($validated['building'] ?? null),
            'floor' => $this->stated($validated['floor'] ?? null),
            'apartment' => $this->stated($validated['apartment'] ?? null),
            'directions' => $this->stated($validated['directions'] ?? null),
            'postal_code' => $this->stated($validated['postal_code'] ?? null),
        ];
    }

    /**
     * An empty string is not a shorter line, it is an absent one.
     */
    private function stated(mixed $value): ?string
    {
        $trimmed = trim((string) ($value ?? ''));

        return $trimmed === '' ? null : $trimmed;
    }
}
