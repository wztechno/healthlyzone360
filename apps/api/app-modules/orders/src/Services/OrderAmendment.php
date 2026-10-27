<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Enums\PaymentMethod;

/**
 * What a member of staff wants changed on an order already placed.
 *
 * `lines` is always the whole basket — the order's lines become exactly these.
 * Every other field is optional, and null means **keep what is stored**: an edit
 * that only changes a quantity must not quietly move the slot, the day or the
 * address the customer was promised. Who the customer is and how the food leaves
 * are not here at all; to change either, cancel and re-sell.
 */
final readonly class OrderAmendment
{
    /**
     * @param  list<ComposedLine>  $lines
     * @param  CustomerAddress|null  $address  a new delivery address, already scoped to the order's customer
     */
    public function __construct(
        public array $lines,
        public ?CustomerAddress $address = null,
        public ?CarbonImmutable $requestedDate = null,
        public ?string $windowCode = null,
        public ?PaymentMethod $paymentMethod = null,
    ) {}
}
