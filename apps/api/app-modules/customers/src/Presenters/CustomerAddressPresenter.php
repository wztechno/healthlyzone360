<?php

declare(strict_types=1);

namespace Healthy360\Customers\Presenters;

use Healthy360\Customers\Models\CustomerAddress;

/**
 * A customer's address book, as its owner sees it.
 *
 * Every free-text part is served in full. The model classifies them
 * `Confidential` and the logs redact them, but this shape reaches exactly one
 * audience — the person who typed them — and a masked address book is a screen
 * on which nobody can tell which address is which.
 *
 * `is_deliverable` is carried alongside the area rather than left to the client
 * to work out, and it is not the same question as "was this accepted". An
 * address is checked against the served areas when it is saved, but coverage
 * moves: a kitchen closes, a zone is paused, and an address that was
 * deliverable in March is not in April. A book that showed only what was true
 * at save time would let somebody choose an address nothing can be sent to,
 * and they would find out at checkout.
 */
final class CustomerAddressPresenter
{
    /**
     * @return array{
     *     id: string,
     *     address_type: string,
     *     delivery_area_id: string,
     *     label: string|null,
     *     line_one: string,
     *     line_two: string|null,
     *     building: string|null,
     *     floor: string|null,
     *     apartment: string|null,
     *     directions: string|null,
     *     postal_code: string|null,
     *     contact_point_id: string|null,
     *     is_default: bool,
     *     is_deliverable: bool,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function address(CustomerAddress $address, bool $isDeliverable): array
    {
        return [
            'id' => (string) $address->getKey(),
            'address_type' => $address->address_type->value,
            'delivery_area_id' => $address->delivery_area_id,
            'label' => $address->label,
            'line_one' => $address->line_one,
            'line_two' => $address->line_two,
            'building' => $address->building,
            'floor' => $address->floor,
            'apartment' => $address->apartment,
            'directions' => $address->directions,
            'postal_code' => $address->postal_code,
            'contact_point_id' => $address->contact_point_id,
            'is_default' => $address->is_default,
            'is_deliverable' => $isDeliverable,
            'lock_version' => $address->lock_version,
            'created_at' => $address->created_at?->toIso8601String(),
            'updated_at' => $address->updated_at?->toIso8601String(),
        ];
    }
}
