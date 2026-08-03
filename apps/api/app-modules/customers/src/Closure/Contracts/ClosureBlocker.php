<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Contracts;

use App\Models\User;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * One reason a closure might not be allowed to proceed.
 *
 * **An interface with one method, and the shape is the point.** Every blocker
 * answers the same question about the same subject and returns the same
 * verdict, so the registry can run all of them, report all of them, and re-run
 * all of them at finalisation without knowing what any of them do. A closure
 * service that asked each neighbour its own question in its own vocabulary
 * would acquire a dependency per neighbour and would silently stop asking one
 * the day its module moved.
 *
 * **A blocker that cannot check must say so.** Returning `clear` when nothing
 * was inspected is the failure mode the whole registry exists to prevent —
 * see `BlockerStatus::NotApplicable`.
 *
 * Implementations live in `Closure/Blockers`. They are registered in
 * `CustomersServiceProvider`, not discovered, because the order they appear in
 * is the order a customer reads them.
 */
interface ClosureBlocker
{
    /**
     * The stable identifier this blocker reports under.
     *
     * Read by clients and by tests, so it is a method rather than a class name:
     * renaming a class must not change an API contract.
     */
    public function code(): string;

    /**
     * What stands in the way, for this identity and this account.
     *
     * `$account` is nullable because not every closing identity holds a
     * customer account — a kitchen's staff login has memberships and no orders
     * — and a blocker that assumed one would crash the journey for exactly the
     * people whose closure is simplest.
     */
    public function evaluate(User $user, ?CustomerAccount $account): BlockerVerdict;
}
