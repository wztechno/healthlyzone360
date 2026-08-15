<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Blockers;

use App\Models\User;
use Healthy360\Customers\Closure\Contracts\ClosureBlocker;
use Healthy360\Customers\Closure\Contracts\SubscriptionPresence;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * A standing arrangement nobody has ended.
 *
 * A live subscription is a promise to keep generating orders. Closing the
 * account under it would leave a generator producing food for a person who no
 * longer exists — and, worse, would do it against an address the closure has
 * just scrubbed. The customer must cancel or pause it themselves, which is a
 * decision with money attached and is theirs to make.
 *
 * **Two questions, not one.** A paused subscription is live with nothing on the
 * way; one cancelled inside its notice window is dead with tomorrow's delivery
 * already generated. Either is a reason to refuse, and asking only the first
 * would let the second through — which is the case where somebody thinks they
 * have cancelled and the food arrives anyway.
 *
 * **The `not_applicable` here has an expiry date and that is the whole point.**
 * The subscriptions module lands in the same wave as this one; until
 * integrator-2 binds the adapter, the null default answers `isAvailable()`
 * false and this reports `subscriptions_module_absent` — a statement that
 * nothing was checked, never a claim that nothing was found. A
 * `not_applicable` that survived the wave would be the permanently-false
 * blocker the master plan (§9) refuses to ship, and the reason is worded so
 * that anybody reading it after the wave can see it is stale.
 */
final class ActiveSubscriptionsBlocker implements ClosureBlocker
{
    public function __construct(private readonly SubscriptionPresence $subscriptions) {}

    public function code(): string
    {
        return 'active_subscriptions';
    }

    public function evaluate(User $user, ?CustomerAccount $account): BlockerVerdict
    {
        if (! $this->subscriptions->isAvailable()) {
            return BlockerVerdict::notApplicable($this->code(), 'subscriptions_module_absent');
        }

        if (! $account instanceof CustomerAccount) {
            return BlockerVerdict::clear($this->code());
        }

        $accountId = (string) $account->getKey();
        $live = $this->subscriptions->activeSubscriptionCount($accountId);

        if ($live > 0) {
            return BlockerVerdict::blocking($this->code(), $live, 'subscriptions_live');
        }

        if ($this->subscriptions->hasUpcomingDeliveries($accountId)) {
            return BlockerVerdict::blocking($this->code(), 1, 'deliveries_upcoming');
        }

        return BlockerVerdict::clear($this->code());
    }
}
