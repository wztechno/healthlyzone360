<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;

/**
 * An order the platform composed on a customer's behalf — everything a
 * placement needs, with no basket behind it.
 *
 * **Why a basket could not be used instead.** `carts` carries a partial unique
 * index — one open cart per customer per channel — which is right for shopping
 * and fatal here: a subscriber filling their own basket on the web shop on the
 * morning their Tuesday delivery is generated would make the generation fail on
 * a unique violation, and the failure would look like a platform fault rather
 * than the collision it is. A transient cart would also have to be created,
 * converted and reconciled inside the same transaction, leaving a row in the
 * customer's basket history for something they never shopped for.
 *
 * So the composed placement is its own shape, and every field a cart used to
 * supply is stated explicitly: the seller, the channel that prices and offers,
 * the branch that produces, and the currency the whole order is denominated in.
 * Nothing is inferred, because there is nothing left to infer it from — and the
 * checks that follow (eligibility, address ownership, zone, cut-off, line
 * orderability) are exactly the ones a basket placement runs.
 *
 * `requestedDate` is effectively required for a composed placement: a
 * subscription delivery is for one named day, and the branch cut-off cannot be
 * asked about a day nobody named. It is nullable only because the type mirrors
 * `place()`'s.
 */
final readonly class ComposedPlacement
{
    /**
     * @param  list<ComposedLine>  $lines
     */
    public function __construct(
        public CustomerAccount $account,
        public CustomerAddress $address,
        public string $organisationId,
        public string $salesChannelId,
        public ?string $branchId,
        public string $currencyCode,
        public array $lines,
        public ?string $deliveryWindowCode = null,
        public ?CarbonImmutable $requestedDate = null,
    ) {}
}
