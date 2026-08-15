<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;

/**
 * What somebody is asking to subscribe to.
 *
 * Checkout-shaped on purpose: the same three coordinates a plan is sold on —
 * the plan, the configuration cell, the duration — plus everything a delivery
 * needs. A value object rather than an array so that the HTTP layer
 * integrator-2 writes and the console command that stands a test world up are
 * building the same thing, and so that adding a field is a type error in both
 * rather than a silent default in one.
 *
 * `weekdays` is ISO (1 = Monday … 7 = Sunday) and must not be empty — the
 * table's own CHECK says so, and `SubscriptionService` refuses it with a
 * sentence first.
 *
 * `startFrom` is the earliest delivery date the customer wants. It is a
 * *request*, not a promise: the service moves it forward to the first weekday
 * the subscription actually delivers on that is still outside the plan's change
 * window, because a subscription whose first delivery is already inside its own
 * cut-off would generate an order the customer could never have changed.
 */
final readonly class NewSubscription
{
    /**
     * @param  list<int>  $weekdays  ISO weekdays, 1 = Monday … 7 = Sunday
     */
    public function __construct(
        public CustomerAccount $account,
        public CustomerAddress $address,
        public string $salesChannelId,
        public ?string $branchId,
        public string $catalogueItemId,
        public string $catalogueItemVariantId,
        public string $planDurationId,
        public array $weekdays,
        public ?string $deliveryWindowCode = null,
        public bool $noSubstitutions = false,
        public ?CarbonImmutable $startFrom = null,
    ) {}
}
