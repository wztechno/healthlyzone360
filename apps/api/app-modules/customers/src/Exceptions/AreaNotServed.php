<?php

declare(strict_types=1);

namespace Healthy360\Customers\Exceptions;

use RuntimeException;

/**
 * Nobody delivers to the area this address names.
 *
 * A refusal at *save* time rather than at checkout, because an address book is
 * a promise: a customer who saved an address expects an order to it to work,
 * and discovering otherwise at the payment step is the worst possible moment.
 * The narrower branch-aware check still happens at checkout (C1), where the
 * kitchen is known.
 */
final class AreaNotServed extends RuntimeException
{
    public function __construct(public readonly string $areaId)
    {
        parent::__construct('No kitchen currently delivers to that area.');
    }

    public function reason(): string
    {
        return 'address.area_not_served';
    }

    /**
     * @return array<string, string>
     */
    public function details(): array
    {
        return ['delivery_area_id' => $this->areaId];
    }
}
