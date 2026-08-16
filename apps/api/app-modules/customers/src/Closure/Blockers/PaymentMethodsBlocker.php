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
 *
 * ## The three money tables that are somebody else's evidence, not a customer's
 * ## instrument
 *
 * The sweep is a substring match on `payment` and `card`, which is broad on
 * purpose, and three tables now match it that this blocker is not the right
 * answer for. Each is excluded by name, and the reason is the same rule stated
 * three times: **a stored instrument belongs to the person leaving; a payment
 * record belongs to the kitchen that took the money.** Closure erases the
 * first. It must not touch the second.
 *
 *  * **`order_payment_receipts`** (Order Desk) — a kitchen's own statement that
 *    money arrived against one of its orders: organisation, order, method,
 *    amount, and the member of **staff** who asserted it. There is no customer
 *    column on it at all. It is a seller's book, and deleting a day's takings
 *    because a buyer closed their account would destroy the accounting record of
 *    a transaction that really happened, for a party who is not the one leaving.
 *  * **`payment_intents`** (C1 payments) — a `unique(order_id)` attempt to move
 *    money for one order. Same shape, same owner, same answer.
 *  * **`payment_method_records`** (C1 payments) — the table this blocker is
 *    named after, and the one that needed arguing rather than asserting. See
 *    below.
 *
 * **Closure already governs the first two, through the order.** They are not
 * unreachable from a closure; they are reached the way everything order-shaped
 * is. `OpenOrdersBlocker` refuses a closure while any order is still in flight,
 * so nothing is receipted underneath a customer mid-erasure, and the personal
 * half of a settled order — the delivery snapshot, the contact point — is
 * handled by the `OrderAnonymisation` port under closure's own retention rules.
 * A receipt carries none of that half. Blocking on one would be telling somebody
 * they cannot leave until a kitchen has finished its bookkeeping, and deleting
 * one would be resolving a data-protection question by destroying a third
 * party's financial record.
 *
 * ## `payment_method_records`, and the debt this exclusion carries
 *
 * This one is not comfortable and should not be made to look it.
 * `payment_method_records` is a *stored instrument* table by design — nullable
 * `customer_account_id`, a `provider_ref` the migration describes as an
 * "external token or mandate id" — which is precisely the shape the tripwire
 * was written about. It predates the Order Desk by a fortnight and it is
 * excluded here on one fact and one fact only: **nothing on this platform
 * writes it.** No controller, no service, no factory, no seeder inserts a row;
 * `PaymentService` creates intents and never a method record, and the model
 * exists solely to hang the intent's `belongsTo` on. It is C1 skeleton, and a
 * blocker that queried it would be asking a question whose answer is structurally
 * zero.
 *
 * That makes the honest verdict `not_applicable` — nothing was checked, because
 * there is nothing in this deployment to check against — which is exactly what
 * this class already says, and what `ClosureBlockerHonestyTest` pins as
 * `no_payment_module` on a wire vocabulary that reaches three translated
 * catalogues.
 *
 * **What is owed, and when.** The moment anything writes a row into this table,
 * the exclusion becomes the lie the tripwire exists to prevent, and the sweep
 * will no longer say so. Whoever gives it its first writer owes this class a
 * real check — count the closing customer's instruments, `clear` when there are
 * none and `blocking` when there are, dropping the tenancy scope the way
 * `ActiveOrganisationMembershipsBlocker` documents at length, because a closure
 * runs with no ambient organisation and `PaymentMethodRecord` is
 * `OrganisationScoped`. The exclusion is by **exact name**, so a table PAY1 adds
 * beside it still trips the sweep; it is only this one, empty, writer-less table
 * that the tripwire has been asked to stop asking about.
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
     * Every entry is argued in the class docblock, and every entry is an **exact
     * table name** rather than a pattern: excluding a name says nothing about
     * the next table somebody adds beside it, which is what keeps the sweep
     * useful after each exclusion.
     *
     * @var list<string>
     */
    public const array EXCLUDED_TABLES = [
        'personal_access_tokens',
        'order_payment_receipts',
        'payment_intents',
        'payment_method_records',
    ];

    public function code(): string
    {
        return 'payment_methods';
    }

    public function evaluate(User $user, ?CustomerAccount $account): BlockerVerdict
    {
        return BlockerVerdict::notApplicable($this->code(), 'no_payment_module');
    }
}
