<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Contracts;

/**
 * Redact the person out of the orders, and keep the orders.
 *
 * **Both halves are obligations and they pull against each other.** An order is
 * a commercial and tax record with a statutory retention of its own: deleting
 * it because the customer asked to be forgotten would destroy the kitchen's
 * books and the tax authority's evidence, and no erasure right requires that.
 * But the row as placed carries a delivery address, and an address is a person.
 * So the row survives with its money, its dates and its geography, and the
 * columns that would take a courier to somebody's door are overwritten.
 *
 * **What must survive, stated so an implementation cannot quietly decide
 * otherwise:** the order identifier and number, every amount, the currency, the
 * status and its timestamps, the sales channel, the branch, and the delivery
 * *area* and *city*. The area is the unit tax and coverage are computed on and
 * is classified `Public` on the orders table — a district appears on a
 * kitchen's own coverage map. A redaction that took the area with the street
 * would break the books in the name of protecting a fact the kitchen publishes.
 *
 * **What must go:** every column that names a place a person can be found or a
 * person who can be found there — the address lines and any label somebody
 * typed, plus any customer-name snapshot the module holds now or acquires
 * later. The implementation owns that list, because the module that owns the
 * columns is the only one that can keep the list current.
 *
 * **Why a port.** The redaction cannot live in Customers without Customers
 * learning the order schema and inverting the module graph — the same argument
 * `OpenOrderQuery` makes in the other direction. `GuestDeletionService` already
 * carries a `@todo` asking for exactly this seam; this is it.
 *
 * The default binding is `OrderSnapshotAnonymiser`, a schema-guarded fallback
 * inside this module whose own docblock explains why it exists and when it
 * goes. Where no orders table is present it reports `isAvailable() = false` and
 * redacts nothing, so an absent module shows up in the closure report and the
 * audit trail as an unredacted-orders warning rather than as a silent success.
 */
interface OrderAnonymisation
{
    /**
     * Whether an orders module is bound and can redact.
     *
     * False means the closure completed with order snapshots untouched, which
     * is a defect to be reported loudly, not a clean result.
     */
    public function isAvailable(): bool;

    /**
     * How many order rows this closure deliberately leaves in place.
     *
     * Reported so a customer can be told what survives and why, and so an
     * auditor can see that retention was a decision rather than an omission.
     *
     * @param  string  $customerAccountId  a `customer_accounts` identifier
     */
    public function retainedOrderCount(string $customerAccountId): int;

    /**
     * Overwrite the customer-identifying snapshots on this account's orders.
     *
     * Idempotent by contract: finalisation may run twice, and the second run
     * must neither fail nor find anything left to do.
     *
     * @return int rows whose snapshots were rewritten
     */
    public function anonymiseFor(string $customerAccountId): int;
}
