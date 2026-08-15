<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Customers\Closure\Contracts\OrderAnonymisation;
use Healthy360\Orders\Models\Order;
use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Support\Facades\DB;

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
 * most identifying string on the row — `delivery_line_one` and
 * `delivery_line_two`, and the four columns the fulfilment migration added
 * beside them: `delivery_building`, `delivery_floor`, `delivery_apartment` and
 * `delivery_directions`. The last of those is the sharpest of the set. It is
 * free text a customer wrote for a stranger who has to find them — *the green
 * door past the pharmacy, ring twice, the dog barks* — and it is the field most
 * likely to name a person, a neighbour or a habit. `delivery_contact_point_id`
 * goes with them: it is a reference rather than a copied number, and the row it
 * points at is deleted outright by the closure, but a dangling identifier is
 * still a join key back to a hash and there is nothing left for it to be
 * useful for.
 *
 * **The marker is conditional now, and that is a constraint rather than a
 * preference.** `delivery_line_one` was NOT NULL when this was written, so it
 * was overwritten with a placeholder rather than emptied: a reader looking at a
 * retained order must be able to tell "this was erased" from "this was never
 * filled in". Since the fulfilment migration it is null on exactly the orders
 * that never had an address — a pickup, a counter sale — and
 * `orders_fulfilment_shape_check` **refuses** a non-null address line on both of
 * those shapes. Writing the marker unconditionally would therefore not merely
 * be untrue, it would abort the closure with a check violation the first time
 * somebody who had ever collected an order asked to be forgotten. So the write
 * says what it means: a row that carried an address is marked as erased, and a
 * row that never had one stays null, because there is nothing there to say was
 * taken away.
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
                // Every column this method clears, asked as "is there still
                // something here". The address-line arm is last and is the only
                // one that is not a null check: on a redacted delivery order it
                // is false, and on a pickup or a counter sale the comparison is
                // against NULL and so is never true — which is right, because
                // those rows never held an address to erase.
                $query->whereNotNull('delivery_label')
                    ->orWhereNotNull('delivery_line_two')
                    ->orWhereNotNull('delivery_building')
                    ->orWhereNotNull('delivery_floor')
                    ->orWhereNotNull('delivery_apartment')
                    ->orWhereNotNull('delivery_directions')
                    ->orWhereNotNull('delivery_contact_point_id')
                    ->orWhere('delivery_line_one', '!=', self::REDACTED);
            })
            ->update([
                'delivery_label' => null,
                'delivery_line_one' => self::redactedAddressLine(),
                'delivery_line_two' => null,
                'delivery_building' => null,
                'delivery_floor' => null,
                'delivery_apartment' => null,
                'delivery_directions' => null,
                'delivery_contact_point_id' => null,
                'updated_at' => now(),
            ]);
    }

    /**
     * The address line after erasure: the marker where there was an address,
     * and null where there never was one.
     *
     * An expression rather than a value because one statement covers a
     * customer's whole order history, and that history may hold a delivery
     * beside a collection. A literal would write the marker onto the collection
     * too, and `orders_fulfilment_shape_check` would abort the closure for it.
     * The literal is a compile-time constant of this class, so there is nothing
     * to bind.
     */
    private static function redactedAddressLine(): Expression
    {
        return DB::raw("CASE WHEN delivery_line_one IS NULL THEN NULL ELSE '".self::REDACTED."' END");
    }
}
