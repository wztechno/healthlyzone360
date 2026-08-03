<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Services;

use Healthy360\Customers\Closure\Contracts\OrderAnonymisation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * The default `OrderAnonymisation`: redact the address off the order, keep the
 * order.
 *
 * **Read the deviation note before moving this.** The contract says the orders
 * module implements it, and it should — the module that owns the columns is the
 * only one that can keep the redaction list current as columns are added. This
 * class exists because J2 shipped in a wave where nobody owned the orders
 * module, and shipping the port with only a do-nothing default would have meant
 * every closure completing with a full delivery address still on file and
 * nothing failing to say so. A silent gap in an erasure is worse than a
 * documented one.
 *
 * So it is written as the seam's *fallback*, not its answer:
 *
 *  * bound with `bindIf`, so an orders-module implementation supersedes it
 *    without a conflict and without this file being edited;
 *  * guarded on `Schema::hasTable`, so in a deployment without orders it
 *    degrades to the honest null behaviour — `isAvailable()` false, nothing
 *    redacted, the closure report saying so;
 *  * reaching the table through the query builder rather than the `Order`
 *    model, so it acquires none of the orders module's vocabulary and deleting
 *    this class removes the dependency entirely.
 *
 * `GuestDeletionService::retainedOrderCount()` already reaches the orders table
 * this way for the count, with a `@todo` asking for precisely this port. When
 * the orders-side implementation lands, both call sites collapse onto it and
 * this file goes.
 *
 * **What it keeps and what it takes** is the contract's list, not this class's
 * opinion: amounts, dates, status, channel, branch, and the delivery *area* and
 * *city* all survive — the area is `Public` on that table and is what tax and
 * coverage are computed on. The address lines and the customer's own label for
 * the place are overwritten.
 */
final class OrderSnapshotAnonymiser implements OrderAnonymisation
{
    /**
     * What replaces an address line.
     *
     * A constant rather than an empty string, because `delivery_line_one` is
     * NOT NULL and because a reader looking at a retained order should be able
     * to tell "this was erased" from "this was never filled in".
     */
    public const string REDACTED = '[redacted]';

    public function isAvailable(): bool
    {
        return Schema::hasTable('orders');
    }

    public function retainedOrderCount(string $customerAccountId): int
    {
        if (! $this->isAvailable()) {
            return 0;
        }

        try {
            return DB::table('orders')->where('customer_account_id', $customerAccountId)->count();
        } catch (Throwable) {
            // A tree mid-merge: the table exists without the column. A closure
            // must not fail because a count could not be taken.
            return 0;
        }
    }

    public function anonymiseFor(string $customerAccountId): int
    {
        if (! $this->isAvailable()) {
            return 0;
        }

        try {
            // The `where` on the placeholder is the idempotence guard the
            // contract promises: a second finalisation matches no rows and
            // returns zero rather than rewriting the same redaction.
            return DB::table('orders')
                ->where('customer_account_id', $customerAccountId)
                ->where(function ($query): void {
                    $query->where('delivery_line_one', '!=', self::REDACTED)
                        ->orWhereNotNull('delivery_line_two')
                        ->orWhereNotNull('delivery_label');
                })
                ->update([
                    'delivery_label' => null,
                    'delivery_line_one' => self::REDACTED,
                    'delivery_line_two' => null,
                    'updated_at' => now(),
                ]);
        } catch (Throwable) {
            return 0;
        }
    }
}
