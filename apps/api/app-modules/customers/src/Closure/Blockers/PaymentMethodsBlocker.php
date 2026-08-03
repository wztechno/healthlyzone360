<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Blockers;

use App\Models\User;
use Healthy360\Customers\Closure\Contracts\ClosureBlocker;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * Stored payment instruments that would have to be destroyed with the account.
 *
 * **There are none, and the orders module has an architecture test to keep it
 * that way.** Cash on delivery is the whole of C1; `OrderArchitectureTest`
 * already fails the build if a payment column appears on an order table,
 * because the first thing to write a card reference into a schema with no PCI
 * scope creates a liability no later migration removes. This blocker is the
 * closure-side counterpart of that rule.
 *
 * So the verdict is `not_applicable` with `no_payment_module` — nothing was
 * checked because there is nothing to check — and the honesty is enforced
 * rather than promised: `ClosurePaymentTripwireTest` fails the moment a table
 * matching `%payment%` or `%card%` exists without a blocker or purge policy
 * covering it.
 *
 * **`personal_access_tokens` is excluded from that sweep by name**, and the
 * exclusion is worth stating because it looks like a hole. It matches nothing
 * in the payment vocabulary; it is caught only by a substring sweep broad
 * enough to be useful, it is a Sanctum table, and closure already revokes every
 * row of it in `AccountAnonymiser`. Excluding it keeps the tripwire pointed at
 * the thing it is for; the alternative is a permanently failing test, and a
 * test that always fails is a test nobody reads.
 */
final class PaymentMethodsBlocker implements ClosureBlocker
{
    /**
     * The table-name fragments this blocker claims responsibility for.
     *
     * @var list<string>
     */
    public const array COVERS = ['payment', 'card'];

    /**
     * Tables that match the fragments above and are none of this blocker's
     * business.
     *
     * @var list<string>
     */
    public const array EXCLUDED_TABLES = ['personal_access_tokens'];

    public function code(): string
    {
        return 'payment_methods';
    }

    public function evaluate(User $user, ?CustomerAccount $account): BlockerVerdict
    {
        return BlockerVerdict::notApplicable($this->code(), 'no_payment_module');
    }
}
