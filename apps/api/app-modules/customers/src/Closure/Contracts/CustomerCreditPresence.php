<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Contracts;

/**
 * "Is the platform still holding a debt owed *to* this customer?"
 *
 * **The one direction of value the platform does hold.** `WalletBalanceBlocker`
 * says there are no wallets, and it is right — nothing here stores value a
 * customer has put in. But S1's `credit_memos` are the mirror image: when a
 * subscription is cancelled early, the unused days are recorded as an amount
 * the *kitchen* owes the customer, settled by hand because there is no payment
 * rail. That is customer-held value by any reading, and the wallet blocker's
 * own `COVERS` constant says so explicitly — it declines to claim `credit`,
 * names `credit_memos` as outside its remit, and raises it for the integrator
 * rather than converting an open question into a false all-clear.
 *
 * This port is that question, closed.
 *
 * **Declared here rather than imported from Subscriptions**, for the reason
 * `SubscriptionPresence` gives one file over: closure must run in a deployment
 * where S1 was never built, and must be able to say "nobody looked" rather than
 * "nothing owed". The null default answers `isAvailable() = false`; the S1
 * adapter answers true and the blocker becomes real without the blocker
 * changing.
 *
 * **A count and not a total.** A memo carries an amount and a currency, and a
 * customer holding two memos in two currencies has no single number. Summing
 * them would produce one, and it would be wrong. The count is what a closure
 * screen needs to say "you have an unsettled refund — talk to us before you
 * go"; the amounts live on the subscription surface, behind the customer's own
 * ownership, where the currency travels with them.
 */
interface CustomerCreditPresence
{
    /**
     * Whether anything in this deployment can answer the question below.
     *
     * False means "no module records what is owed to customers", which is a
     * fact about the platform. It never means "nothing is owed".
     */
    public function isAvailable(): bool;

    /**
     * How many recorded-but-unsettled obligations the platform holds toward
     * this customer.
     *
     * `recorded` only. A settled memo is history — the money changed hands and
     * somebody said so — and history blocks and advises nothing.
     *
     * @param  string  $customerAccountId  a `customer_accounts` identifier
     */
    public function unsettledCreditCount(string $customerAccountId): int;
}
