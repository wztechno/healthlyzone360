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
 * the place are overwritten, along with the building, floor, flat, the
 * customer's own directions to their door and the reference to the number the
 * courier was given.
 *
 * Those five moved in step with the orders-module implementation rather than
 * being left behind, and the reason is what this class is *for*: it runs in a
 * tree where that implementation is absent, and a fallback that redacted less
 * than the real one would make "was this closure complete" depend on which
 * binding happened to win. The address line is written **conditionally** for
 * the same reason it is there — since the fulfilment migration it is null on
 * orders that never had an address, and `orders_fulfilment_shape_check` refuses
 * a marker on those shapes.
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
                    $query->whereNotNull('delivery_label')
                        ->orWhereNotNull('delivery_line_two')
                        ->orWhereNotNull('delivery_building')
                        ->orWhereNotNull('delivery_floor')
                        ->orWhereNotNull('delivery_apartment')
                        ->orWhereNotNull('delivery_directions')
                        ->orWhereNotNull('delivery_contact_point_id')
                        // Never true where the column is null, which is exactly
                        // the orders that never carried an address.
                        ->orWhere('delivery_line_one', '!=', self::REDACTED);
                })
                ->update([
                    'delivery_label' => null,
                    // The marker where there was an address, null where there
                    // never was one. A literal here would write it onto a
                    // pickup or a counter sale in the same history and the
                    // shape CHECK would abort the closure.
                    'delivery_line_one' => DB::raw("CASE WHEN delivery_line_one IS NULL THEN NULL ELSE '".self::REDACTED."' END"),
                    'delivery_line_two' => null,
                    'delivery_building' => null,
                    'delivery_floor' => null,
                    'delivery_apartment' => null,
                    'delivery_directions' => null,
                    'delivery_contact_point_id' => null,
                    'updated_at' => now(),
                ]);
        } catch (Throwable) {
            return 0;
        }
    }
}
