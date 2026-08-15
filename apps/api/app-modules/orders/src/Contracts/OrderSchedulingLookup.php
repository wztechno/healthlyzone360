<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

use Carbon\CarbonImmutable;

/**
 * "Can this branch still take an order for that day?"
 *
 * A port for the same reason `AreaServiceLookup` is one: this module needs a
 * single fact from a neighbour and must not acquire the neighbour's whole
 * vocabulary to get it. Order capture has no business knowing that a branch's
 * week is seven rows, that a closed day is stored rather than omitted, that a
 * NULL cut-off means "until the van leaves", or that the times are clock faces
 * in the branch's own timezone. It needs to know whether it is too late.
 *
 * The implementation (`BranchScheduleLookup`) reads the Kitchens module's
 * `branch_opening_hours`, which is the single place that data lives. Declared
 * by the consumer and satisfied by an adapter that knows both sides, so
 * Kitchens keeps knowing nothing about orders and the graph stays acyclic —
 * the registry's Orders → Kitchens edge, and not a reverse one.
 */
interface OrderSchedulingLookup
{
    /**
     * Whether an order placed at `$at` may still ask for delivery on
     * `$requestedDate` from this branch.
     *
     * Returns `true` when the branch has no schedule configured at all.
     * Silence about opening hours is not a statement that the kitchen is
     * closed, and refusing every order from a branch nobody has filled in
     * would make a configuration gap look like a fault to the customer. The
     * gap is visible in the kitchen's own admin surface, which is where it
     * should be answered.
     *
     * @param  string  $branchId  an `organisation_branches` identifier
     * @param  CarbonImmutable  $requestedDate  the day the customer asked for
     * @param  CarbonImmutable  $at  the moment the order is being placed
     */
    public function acceptsOrderFor(string $branchId, CarbonImmutable $requestedDate, CarbonImmutable $at): bool;

    /**
     * Why not — for the surfaces that have to explain a refusal rather than
     * merely make one.
     *
     * `reason` is `closed` when the branch does not trade that weekday and
     * `cut_off_passed` when it does but the moment has gone; `null` when the
     * date is acceptable. `cut_off_at` carries the branch's own clock face so
     * a client can say "orders for Tuesday close at 18:00" instead of "no".
     *
     * @return array{accepted: bool, reason: string|null, cut_off_at: string|null}
     */
    public function explain(string $branchId, CarbonImmutable $requestedDate, CarbonImmutable $at): array;
}
