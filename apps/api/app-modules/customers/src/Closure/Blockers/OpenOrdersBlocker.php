<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Blockers;

use App\Models\User;
use Healthy360\Customers\Closure\Contracts\ClosureBlocker;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Contracts\OpenOrderQuery;

/**
 * Food that is already on its way.
 *
 * **The blocker with the most physical consequence, and the reason the registry
 * is consulted twice.** An order that is placed but not delivered is a courier
 * heading for an address this closure is about to overwrite. Closing underneath
 * it does not merely lose a record: somebody's dinner arrives at a redacted
 * street and the kitchen cannot tell them why.
 *
 * Asked through `OpenOrderQuery` — a port the orders module declares and binds
 * for exactly this consumer — so closure never learns what an order line is.
 * **This blocker is real today**, which is why J2 was sequenced after C1: a
 * closure journey whose flagship check was a permanent `not_applicable` would
 * have taught everybody reading it that the honest answer is decorative.
 *
 * An identity with no customer account has nothing to have ordered, and the
 * verdict is `clear` rather than `not_applicable`: the question was asked and
 * the answer is genuinely nothing, which is a different fact from "no orders
 * module is bound".
 */
final class OpenOrdersBlocker implements ClosureBlocker
{
    public function __construct(private readonly OpenOrderQuery $orders) {}

    public function code(): string
    {
        return 'open_orders';
    }

    public function evaluate(User $user, ?CustomerAccount $account): BlockerVerdict
    {
        if (! $account instanceof CustomerAccount) {
            return BlockerVerdict::clear($this->code());
        }

        $summaries = $this->orders->openOrderSummaries((string) $account->getKey());

        if ($summaries === []) {
            return BlockerVerdict::clear($this->code());
        }

        return BlockerVerdict::blocking($this->code(), count($summaries), 'orders_in_flight');
    }
}
