<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * The parallel sales ledger and the second ticket rail are demolished.
 *
 * **What was here.** Five tables across two modules, both laid down in the
 * phase-2 scaffolding wave and neither ever finished. `pos_registers`,
 * `pos_shifts`, `pos_transactions` and `pos_transaction_lines` were a
 * second, private record of what a kitchen had sold: a till, who was standing
 * at it, and a money total with lines under it. `kitchen_display_tickets` was
 * a rail of work-in-progress keyed by a `source_type`/`source_id` pair that
 * named an order line or a production batch.
 *
 * **Why removal rather than repair.** The POS family was not an incomplete
 * order desk; it was a competing one, and every fact it recorded was a fact
 * the order book already owns better.
 *
 *  * **No `Order`.** A counter sale wrote a `pos_transactions` row and
 *    stopped. It never appeared in the kitchen's book, never reached the
 *    order lifecycle, and could not be confirmed, cancelled or fulfilled —
 *    so a kitchen's own answer to "what did we sell today" depended on which
 *    of two ledgers you asked.
 *  * **Client-trusted money.** `line_total_minor` arrived in the request
 *    body. Nothing resolved a price list, so a counter sale was priced by
 *    whatever the caller typed — the one thing `PriceResolver` and
 *    `OrderPlacementService` exist to prevent.
 *  * **No stock movement.** Selling a meal at the till took nothing off the
 *    shelf. `OrderStockConsumption` deducts on order confirmation; a POS sale
 *    never confirmed an order, so INV1.2's COGS and the on-hand levels
 *    diverged from reality by exactly the counter's takings.
 *  * **No customer.** There was no account, no contact point and no address
 *    on a transaction, so a walk-in could not be rung back, refunded through
 *    the payments module, or served again as anyone in particular.
 *  * **No services at all.** The module was four models, one controller and
 *    an empty provider. There was no domain layer to fix — repair would have
 *    meant writing the Order Desk inside `app-modules/pos/` and then
 *    reconciling two order books forever.
 *
 * `kitchen_display_tickets` fails the same way for a shorter reason: **nothing
 * ever wrote to it**. The rail that kitchens actually use reads
 * `GET /catalogue/orders`, which serves real orders with real lifecycle
 * states; this table could only have shown a copy of them, kept in step by
 * projection code that was never built. A stub table that no producer fills is
 * not a foundation, it is a trap for the next person who trusts the schema.
 *
 * The Order Desk (`app-modules/orders/src/OrderDesk/`) replaces the POS on the
 * order book proper: a counter sale becomes an `Order` through
 * `OrderLifecycle`, priced by the same resolver as every other sale, deducting
 * the same stock, against a customer who exists.
 *
 * **`SalesChannelKind::Pos` survives, and is a different thing entirely.** The
 * enum case is a *sales channel kind* — the answer to "where was this sold" on
 * a catalogue item's channel assignments and a price list's audience — and it
 * is used by the kitchens module and by `DemoTenantSeeder`'s `counter`
 * channel. Selling at a counter remains a real channel long after the
 * counter's private ledger stops being a real table.
 *
 * **No row-level-security step, and worth stating because the shape invites
 * one.** None of these five tables ever carried a policy:
 * `2026_08_10_000201_scope_pos_shifts_to_their_organisation` gave `pos_shifts`
 * the organisation column it was missing and argued explicitly *against* a
 * policy (`app-scope`, on the `carts`/`orders` precedent), and its siblings
 * never had one either. The `RlsTest` pin therefore stays at eleven tables
 * across this migration rather than dropping to ten — the set is unchanged
 * because nothing in it is being dropped. Had a policy existed, `DROP TABLE`
 * would have taken it with the table and no separate statement would have been
 * needed.
 *
 * **Drop order is the foreign-key graph read backwards**: lines reference
 * transactions, transactions reference shifts, shifts reference registers.
 * `kitchen_display_tickets` references only `organisations` and
 * `organisation_branches`, so it stands alone. `dropIfExists` throughout,
 * because the two `create` migrations leave this repository in the same commit
 * and a database built from scratch afterwards never has these tables to drop.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('pos_transaction_lines');
        Schema::dropIfExists('pos_transactions');
        Schema::dropIfExists('pos_shifts');
        Schema::dropIfExists('pos_registers');

        Schema::dropIfExists('kitchen_display_tickets');
    }

    public function down(): void
    {
        throw new RuntimeException(
            'The POS and kitchen-display tables cannot be restored: their migrations, models and '
            .'controllers were deleted in the same commit that dropped them, so there is no code '
            .'left for a recreated schema to serve. A demolition does not un-happen — the Order '
            .'Desk is the way back to a counter sale.'
        );
    }
};
