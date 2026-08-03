<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Blockers;

use App\Models\User;
use Healthy360\Customers\Closure\Contracts\ClosureBlocker;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * Money the platform is holding that belongs to the person leaving.
 *
 * **There is none, because there are no wallets.** Nothing in this platform
 * stores value on a customer's behalf: orders are cash on delivery (F-bis #3),
 * there is no top-up, no store credit and no refundable balance. So this
 * blocker reports `not_applicable` with `no_wallet_module`, which is the honest
 * statement that nothing was checked because there is nothing to check against.
 *
 * **Why it exists at all, given that.** Two reasons, and the second is the real
 * one.
 *
 * The first is disclosure: a closure screen that simply omits the question
 * leaves a customer to wonder whether their balance is being quietly kept, and
 * an omission is not an answer.
 *
 * The second is that this class is one half of a tripwire. The registry
 * declares that wallets and payment methods are things a closure has an opinion
 * about; `ClosurePaymentTripwireTest` fails the build the moment a table
 * matching `%wallet%`, `%payment%` or `%card%` appears without a blocker or a
 * purge policy that can see it. A `not_applicable` alone would rot into a lie
 * the first time PAY1 landed — somebody adds a balance table, this class keeps
 * returning "no wallet module", and the closure screen keeps saying so. The
 * test is what stops that being possible, and this class is what the test
 * checks for. Neither half works alone.
 *
 * When PAY1 lands, this class gains a port exactly like the subscriptions one
 * and the reason string disappears with the last deployment that lacked a
 * wallet.
 */
final class WalletBalanceBlocker implements ClosureBlocker
{
    /**
     * The table-name fragments this blocker claims responsibility for.
     *
     * Read by the tripwire test, which fails if a table matching any of them
     * exists while this blocker is still answering `not_applicable`. Declared
     * as data rather than described in prose so the test and the blocker cannot
     * drift apart.
     *
     * The fragment is `wallet` alone, deliberately. Widening it to `balance` or
     * `credit` would be a unilateral decision about tables other modules own —
     * `credit_memos` (S1) is customer-held value that this blocker does **not**
     * yet consider, and quietly claiming it here would convert an open question
     * into a false all-clear. It is raised for the integrator instead, which is
     * what an honest blocker does with something outside its remit.
     *
     * @var list<string>
     */
    public const array COVERS = ['wallet'];

    public function code(): string
    {
        return 'wallet_balance';
    }

    public function evaluate(User $user, ?CustomerAccount $account): BlockerVerdict
    {
        return BlockerVerdict::notApplicable($this->code(), 'no_wallet_module');
    }
}
