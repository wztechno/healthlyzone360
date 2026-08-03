<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Customers\Closure\Contracts\OrderAnonymisation;
use Healthy360\Orders\Models\Order;

/**
 * J2's `OrderAnonymisation`, implemented by the module that owns the columns.
 *
 * **This is the implementation the port was declared for.**
 * `OrderSnapshotAnonymiser` in the customers module is the documented fallback
 * J2 shipped when nobody owned this module in that wave; its own docblock says
 * so, and says it goes when this lands. It does not go — a deployment without
 * orders still needs an honest `isAvailable() = false` — but it stops being
 * what runs, because `CustomersServiceProvider` binds it with `bindIf` and
 * `OrdersServiceProvider` binds this one outright.
 *
 * **What survives is the contract's list, restated as columns.** The order
 * identifier and number, every amount, the currency, the status and its
 * timestamps, the sales channel, the branch, the requested delivery date, the
 * delivery window — and the delivery **area** and **city**, including the
 * snapshotted area names. The area is the unit tax and coverage are computed
 * on and a district is on every kitchen's published coverage map; a redaction
 * that took it with the street would break the books in the name of protecting
 * a fact the kitchen publishes.
 *
 * **What goes is every column that would take a courier to a door**:
 * `delivery_label` — a name somebody typed for their own home, frequently the
 * most identifying string on the row — and `delivery_line_one` and
 * `delivery_line_two`. `delivery_line_one` is NOT NULL, so it is overwritten
 * with a marker rather than emptied: a reader looking at a retained order must
 * be able to tell "this was erased" from "this was never filled in".
 *
 * **The list is this module's to keep current**, which is the whole argument
 * for the port running this direction. A column added here that holds a person
 * — a recipient name, a courier note, a phone for the driver — is added by
 * somebody editing this module, and this is the file beside it that has to
 * change. `ClosureAnonymisationSweepTest` is the proof: it sweeps every text
 * column in the schema for the person's own literals and fails on any that
 * survives, so a column added without a redaction fails the build rather than
 * leaking quietly.
 *
 * Written over the `Order` model rather than the query builder, unlike the
 * fallback: this module owns the model, and using it means the cast list and
 * the column names have one definition here rather than two.
 */
final readonly class OrderSnapshotRedaction implements OrderAnonymisation
{
    /**
     * What replaces the one address line that cannot be null.
     *
     * The same literal the customers-module fallback uses, deliberately: a
     * deployment that ran the fallback before this landed has rows carrying it,
     * and a second marker would make "was this order redacted" a question with
     * two answers.
     */
    public const string REDACTED = '[redacted]';

    /**
     * True, unconditionally. The module is present — this class is in it.
     *
     * The port's `isAvailable()` exists so an *absent* orders module reports
     * itself rather than being mistaken for a clean redaction; a present one
     * has nothing to qualify. The `Schema::hasTable` guard the fallback carries
     * belongs to the fallback, whose whole job is to run in a tree where this
     * module may not have migrated.
     */
    public function isAvailable(): bool
    {
        return true;
    }

    public function retainedOrderCount(string $customerAccountId): int
    {
        return Order::query()->where('customer_account_id', $customerAccountId)->count();
    }

    public function anonymiseFor(string $customerAccountId): int
    {
        // The `where` over the already-redacted shape is the idempotence the
        // contract promises: finalisation may run twice — a queue retry after a
        // timeout is the normal case — and the second run must match no rows
        // rather than rewrite the same redaction and report work it did not do.
        return Order::query()
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
    }
}
