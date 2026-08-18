<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A receipt line learns which order line it fulfils, and whether its money is
 * settled (§3.6).
 *
 * ## `purchase_order_line_id` — matching, without guessing
 *
 * A receipt already pointed at a purchase *order*. That is not enough to sum a
 * partial delivery: an order may name the same shelf once, but two deliveries
 * against it must accumulate against **that line**, and a matching rule that
 * inferred the line from the stock item would break the moment anything else
 * changed. So the pointer is explicit and nullable — nullable because a direct
 * market purchase has no order at all, and because §4 allows an unplanned extra
 * item on an ordered delivery, which is a line with a note and no order line
 * behind it.
 *
 * `restrictOnDelete`, matching `purchase_order_lines.stock_item_id`'s own
 * choice and for the same reason: an order line is a record of what was asked
 * for, a receipt line is a record of what turned up, and a record that can
 * quietly lose the row it points at is not a record. Purchase order lines are
 * only ever deleted while their order is still a draft, and a draft has no
 * receipts.
 *
 * The index is partial. Most receipt lines on a market-buying kitchen carry no
 * order line, and "how much of this order line has arrived" is the only question
 * the column is asked.
 *
 * ## `costed_at` — the guard that stops a quantity being costed twice
 *
 * §3.6: late price completion "calls the costing path only for lines whose
 * `costed_at` is null". This is that null. It is stamped when a line's money is
 * **settled**, which is a slightly wider claim than "priced":
 *
 * - a priced line whose stock item is backed by an ingredient is stamped when
 *   the blend goes through;
 * - a priced line with no ingredient behind it — packaging, cleaning supplies —
 *   is stamped too, because there is no average it could ever join and leaving
 *   it null would park its receipt in the work queue forever with nothing to do;
 * - a priced line whose blend was refused for currency is **not** stamped, and
 *   carries `valuation_pending_fx` instead. Its price is recorded and its
 *   valuation is not, which is exactly a job still outstanding.
 *
 * The backfill stamps `created_at` on every already-priced line. That is not the
 * instant the blend ran — it is the instant the line was written, and the blend
 * ran inside the same transaction, so they differ by microseconds and no reader
 * can tell. The alternative, `now()`, would claim every historical line was
 * costed at deploy time, which is a worse lie.
 *
 * ## `valuation_pending_fx` — receiving is never lost to a currency
 *
 * §3.6 is explicit: if the receipt currency cannot be blended into the
 * ingredient's existing valuation currency, the physical receiving must not be
 * lost. The stock is posted, the receipt is saved, the supplier's real price is
 * kept as it was written, and **this flag** is what stops the system pretending
 * the valuation happened. NOT NULL with a default of false because it is a fact
 * about every line — "no, nothing is waiting on an exchange rate" is an answer,
 * not a blank.
 *
 * Nothing here resolves it. A later exchange-rate phase may, and until then the
 * flag is what makes COGS and the cost report visibly incomplete rather than
 * quietly wrong.
 *
 * ADR-0007 isolation unchanged: `goods_receipt_lines` carries no
 * `organisation_id` and is scoped through its receipt, exactly as before.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('goods_receipt_lines', function (Blueprint $table): void {
            // A record pointing at a record — see the class docblock for why this
            // RESTRICTs where a configuration link would CASCADE.
            $table->foreignUuid('purchase_order_line_id')
                ->nullable()
                ->after('stock_item_id')
                ->constrained('purchase_order_lines')
                ->restrictOnDelete();

            $table->timestamp('costed_at')->nullable()->after('cost_currency_code')->comment('when this line\'s money was settled — null means the costing path has not run and price completion may still act on it (§3.6)');

            $table->boolean('valuation_pending_fx')->default(false)->after('costed_at')->comment('the price is recorded but could not be blended into the ingredient\'s valuation currency (§3.6); never resolved here');
        });

        // Every already-priced line was costed in the same transaction that wrote
        // it, so its own creation instant is the truthful stamp.
        DB::statement('UPDATE goods_receipt_lines SET costed_at = created_at WHERE unit_price_amount IS NOT NULL AND costed_at IS NULL');

        DB::statement('ALTER TABLE goods_receipt_lines ALTER COLUMN valuation_pending_fx SET NOT NULL');

        // "How much of this order line has arrived" is the only question the
        // column is asked, and most lines on a market-buying kitchen have no
        // order line at all.
        DB::statement('CREATE INDEX goods_receipt_lines_purchase_order_line_index ON goods_receipt_lines (purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL');

        // The other two reads this slice leans on — a receipt's own lines, and
        // every purchase of one shelf — are already indexed by
        // `2026_08_17_003202_add_last_purchase_price_indexes`, which added them
        // for the last-price queries. One index per read, in one place.
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS goods_receipt_lines_purchase_order_line_index');

        Schema::table('goods_receipt_lines', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('purchase_order_line_id');
            $table->dropColumn(['costed_at', 'valuation_pending_fx']);
        });
    }
};
