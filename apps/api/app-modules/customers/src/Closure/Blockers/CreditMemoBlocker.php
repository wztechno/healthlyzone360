<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Blockers;

use App\Models\User;
use Healthy360\Customers\Closure\Contracts\ClosureBlocker;
use Healthy360\Customers\Closure\Contracts\CustomerCreditPresence;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * Money the kitchen owes the person who is leaving.
 *
 * `WalletBalanceBlocker` covers value a customer put *in*, and there is none —
 * no top-up, no store credit, cash on delivery throughout. This is the other
 * direction, and it is not hypothetical: S1 cancels a subscription by recording
 * a `credit_memo` for the unused days, settled by hand because the platform has
 * no payment rail. The wallet blocker's `COVERS` constant names `credit_memos`
 * as deliberately outside its remit and raises it for the integration wave
 * rather than claiming it silently. This class is the answer.
 *
 * ## Advisory, not blocking — and the reasoning matters more than the verdict
 *
 * The obvious implementation refuses the closure until the memo is settled, and
 * it is wrong in a way that is easy to miss. A memo is a debt the *kitchen*
 * owes the *customer*. Refusing to close an account until it is paid gives the
 * party that owes the money a veto over the erasure of the party owed it — so a
 * kitchen that never gets round to settling could hold somebody's data
 * indefinitely, and the slower it paid the longer it kept them. That is a data
 * protection failure wearing the costume of a consumer protection.
 *
 * It is also not necessary. Nothing about a memo depends on the identity
 * surviving: `credit_memos.customer_account_id` points at a row that closure
 * *anonymises* rather than deletes, so the obligation, its amount, its currency
 * and its subscription all survive the closure intact and remain settleable
 * afterwards. Contrast `ActiveSubscriptionsBlocker`, which genuinely must
 * block: a live subscription would keep generating orders against an address
 * that has just been scrubbed.
 *
 * So the verdict is `advisory` — checked, found, disclosed, and the person
 * leaves if they want to. The count reaches the closure screen and the audit
 * trail, which is what "must be acknowledged" means in a system with no way to
 * make somebody click a box. The amounts deliberately do not travel: see
 * `CustomerCreditPresence` for why a count is the honest summary and a sum
 * across currencies is not.
 *
 * **If this ever should block, that is a policy change and not a bug fix.** It
 * is one line — `advisory` becomes `blocking` — and it belongs to whoever owns
 * the refund policy, alongside PAY1.
 */
final class CreditMemoBlocker implements ClosureBlocker
{
    /**
     * The table-name fragments this blocker claims responsibility for.
     *
     * Read by `ClosurePaymentTripwireTest` exactly as `WalletBalanceBlocker`'s
     * and `PaymentMethodsBlocker`'s are, so this blocker cannot be quietly
     * unbound while `credit_memos` exists: the moment its port falls back to
     * the null default it would answer `not_applicable` against a table that is
     * plainly there, and the tripwire fails the build.
     *
     * `credit_memo` rather than the wider `credit`, on the same argument
     * `WalletBalanceBlocker` makes for `wallet` over `balance`: claiming a
     * fragment is claiming every future table that happens to contain it, and
     * a claim this blocker could not honour would be worse than no claim.
     *
     * @var list<string>
     */
    public const array COVERS = ['credit_memo'];

    public function __construct(private readonly CustomerCreditPresence $credits) {}

    public function code(): string
    {
        return 'unsettled_credit_memos';
    }

    public function evaluate(User $user, ?CustomerAccount $account): BlockerVerdict
    {
        if (! $this->credits->isAvailable()) {
            return BlockerVerdict::notApplicable($this->code(), 'subscriptions_module_absent');
        }

        if (! $account instanceof CustomerAccount) {
            // No consumer account, so nothing was ever owed against one. A
            // staff-only login closing has no refunds by construction.
            return BlockerVerdict::clear($this->code());
        }

        $outstanding = $this->credits->unsettledCreditCount((string) $account->getKey());

        if ($outstanding > 0) {
            return BlockerVerdict::advisory($this->code(), $outstanding, 'credit_memos_unsettled');
        }

        return BlockerVerdict::clear($this->code());
    }
}
