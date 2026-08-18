<?php

declare(strict_types=1);

use Healthy360\Procurement\Services\GoodsReceiptService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The goods receipt becomes the receiving document and the invoice (§3.6).
 *
 * Until now a receipt was a timestamp, a supplier, a delivery-note reference and
 * a set of priced lines. That is enough to raise stock and blend a cost; it is
 * not enough to reconcile a week's purchasing, which is what slice 6 is about to
 * read off these columns. Four things arrive here.
 *
 * ## `received_on` — the business date, beside the instant
 *
 * `received_at` is an exact UTC timestamp and stays exactly that. `received_on`
 * is the **branch-local calendar day** the delivery belongs to, and the two are
 * different facts rather than a duplication: a van unloaded at 21:30 in Dubai is
 * a Tuesday delivery, and `received_at::date` read in UTC would file it on
 * Monday. §3.7 groups spend by ISO week and calendar month, and grouping money
 * by a UTC instant would move a delivery between weeks depending on where the
 * server is standing.
 *
 * The backfill is `received_at::date` and that is the honest best available for
 * a row written before the distinction existed — the branch timezone was never
 * captured on the receipt, so re-deriving it now would be inventing a fact. New
 * rows compute the date in the receiving branch's own timezone
 * ({@see GoodsReceiptService}).
 *
 * ## `supplier_invoice_ref`/`invoice_date` — a second document, not a synonym
 *
 * `document_ref` is the **delivery note** the driver hands over. The invoice
 * arrives separately, often days later, and carries its own number and date.
 * Overloading one column would make "which piece of paper is this?" unanswerable
 * exactly when somebody is reconciling against a supplier statement.
 *
 * ## `variance_note` — because a required explanation must be kept
 *
 * §4 requires an explicit note for an unplanned extra item, and §3.5 requires a
 * variance note for an over-receipt. The plan names the requirement without
 * naming a column, and the two homes that suggested themselves were both wrong:
 * **audit metadata alone** would put the explanation behind
 * `audit.view_organisation`, so the person reading the receipt could see that it
 * over-delivered and not why; and there is no receipt `notes` column to overload.
 * Demanding a sentence and then discarding it would be the plainest form of the
 * silent behaviour this plan refuses, so it is a column.
 *
 * One note per receipt rather than per line, because both cases it answers are
 * the same question — *why does this delivery differ from what was ordered* —
 * and a receipt is the unit a person is looking at when they answer it.
 *
 * ## `cost_status` — is this receipt's costing finished?
 *
 * `unpriced | partial | complete`, and it is derived from the lines rather than
 * set by hand: a line counts as settled when it carries `costed_at`, which the
 * next migration adds. That single rule is what makes the **Unpriced receipts**
 * queue a true work list — a receipt leaves it when there is nothing left to do
 * to it, and not before.
 *
 * The backfill here reads `unit_price_amount` rather than `costed_at`, because
 * `costed_at` does not exist yet when this migration runs. The next migration
 * stamps it from `created_at` on exactly the priced lines, so the two rules
 * agree the moment both have run.
 *
 * The partial index is the queue's own read — `WHERE cost_status <> 'complete'`
 * — because a healthy kitchen's receipts are overwhelmingly complete and an
 * index over all of them would be mostly rows nobody asks for.
 *
 * ## Header charges carry no currency column of their own, deliberately
 *
 * Discount, tax, delivery, other charges and the invoice total are amounts on
 * the receipt; the currency they are in is **the receipt's line currency**,
 * which `goods_receipt_lines.cost_currency_code` already records. A sixth
 * currency column here could disagree with the lines, and §3.6 forbids the state
 * it would express: all priced lines and header adjustments on one receipt share
 * one currency, because there is no exchange rate in this system. The service
 * enforces that on write ({@see GoodsReceiptService}),
 * and a header amount on a receipt with no priced line is refused there for the
 * same reason — an amount with no currency is not an amount (§4.4).
 *
 * The CHECKs here are the ones a database can state on its own: every amount is
 * non-negative. A **discount** is stored positive and subtracted by the
 * arithmetic rather than stored negative, so that the sign convention is in one
 * place rather than in every reader.
 *
 * ## Safe order, on a table that genuinely holds rows
 *
 * Unlike `purchase_orders`, this table is written to in every environment. So
 * the order is the one §2 requires and it matters: **add nullable, backfill,
 * then constrain**. Neither required column needs a human decision — a business
 * date derives from the timestamp and a cost status derives from the lines — so
 * this migration backfills rather than stopping.
 *
 * ADR-0007 isolation is unchanged: `goods_receipts` carries `organisation_id`
 * and is application-scoped, which is what the new `(organisation_id,
 * cost_status)` index is expressed over. No RLS; the `RlsTest` pin does not move.
 */
return new class extends Migration
{
    public function up(): void
    {
        // (a) Nullable first — nothing here is briefly in a state a populated
        // database could not reach.
        Schema::table('goods_receipts', function (Blueprint $table): void {
            $table->date('received_on')->nullable()->after('received_at')->comment('the branch-local calendar day this delivery belongs to — what §3.7 groups spend by');
            $table->string('supplier_invoice_ref', 120)->nullable()->after('document_ref')->comment("the supplier's invoice number — a different document from document_ref, which is the delivery note");
            $table->date('invoice_date')->nullable()->after('supplier_invoice_ref');
            $table->string('variance_note', 255)->nullable()->after('invoice_date')->comment('why this delivery differs from what was ordered — required for an over-receipt and for an unplanned extra item (§4)');
            $table->string('cost_status', 16)->nullable()->after('received_on')->comment('unpriced | partial | complete — derived from the lines carrying costed_at');

            $table->decimal('discount_amount', 18, 6)->nullable()->after('cost_status')->comment('major units in the receipt line currency; stored positive and subtracted by the arithmetic');
            $table->decimal('tax_amount', 18, 6)->nullable()->after('discount_amount');
            $table->decimal('delivery_amount', 18, 6)->nullable()->after('tax_amount');
            $table->decimal('other_charges_amount', 18, 6)->nullable()->after('delivery_amount');
            $table->decimal('invoice_total_amount', 18, 6)->nullable()->after('other_charges_amount')->comment('what the supplier invoiced in total; when present the service checks it against Σ line totals − discount + tax + delivery + other');
        });

        // (b) Backfill. A business date derives from the timestamp and a cost
        // status derives from the lines, so no row needs a human.
        DB::statement('UPDATE goods_receipts SET received_on = received_at::date WHERE received_on IS NULL');

        DB::statement(<<<'SQL'
            UPDATE goods_receipts SET cost_status = CASE
                WHEN NOT EXISTS (SELECT 1 FROM goods_receipt_lines WHERE goods_receipt_lines.goods_receipt_id = goods_receipts.id) THEN 'unpriced'
                WHEN NOT EXISTS (SELECT 1 FROM goods_receipt_lines WHERE goods_receipt_lines.goods_receipt_id = goods_receipts.id AND goods_receipt_lines.unit_price_amount IS NOT NULL) THEN 'unpriced'
                WHEN NOT EXISTS (SELECT 1 FROM goods_receipt_lines WHERE goods_receipt_lines.goods_receipt_id = goods_receipts.id AND goods_receipt_lines.unit_price_amount IS NULL) THEN 'complete'
                ELSE 'partial'
            END
            WHERE cost_status IS NULL
        SQL);

        // (c) Only now the constraints. Raw `ALTER COLUMN` rather than a
        // Blueprint `->change()`, which restates the whole definition and would
        // silently drop the comments written above.
        DB::statement('ALTER TABLE goods_receipts ALTER COLUMN received_on SET NOT NULL');
        DB::statement('ALTER TABLE goods_receipts ALTER COLUMN cost_status SET NOT NULL');

        DB::statement("ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_cost_status_check CHECK (cost_status IN ('unpriced', 'partial', 'complete'))");

        // Every charge is a magnitude. A discount reduces the invoice through the
        // arithmetic, not through a negative sign nobody would remember.
        DB::statement('ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_charges_non_negative_check CHECK ('.
            '(discount_amount IS NULL OR discount_amount >= 0) AND '.
            '(tax_amount IS NULL OR tax_amount >= 0) AND '.
            '(delivery_amount IS NULL OR delivery_amount >= 0) AND '.
            '(other_charges_amount IS NULL OR other_charges_amount >= 0) AND '.
            '(invoice_total_amount IS NULL OR invoice_total_amount >= 0))');

        // The **Unpriced receipts** queue's own read, and nothing else: a healthy
        // kitchen's receipts are overwhelmingly complete, so a full index would
        // be mostly rows nobody asks for.
        DB::statement("CREATE INDEX goods_receipts_cost_status_open_index ON goods_receipts (organisation_id, cost_status) WHERE cost_status <> 'complete'");

        // The business date is what slice 6 groups by and what the ledger's date
        // filter will read, per branch.
        DB::statement('CREATE INDEX goods_receipts_received_on_index ON goods_receipts (organisation_id, received_on DESC)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS goods_receipts_received_on_index');
        DB::statement('DROP INDEX IF EXISTS goods_receipts_cost_status_open_index');

        DB::statement('ALTER TABLE goods_receipts DROP CONSTRAINT IF EXISTS goods_receipts_charges_non_negative_check');
        DB::statement('ALTER TABLE goods_receipts DROP CONSTRAINT IF EXISTS goods_receipts_cost_status_check');

        Schema::table('goods_receipts', function (Blueprint $table): void {
            $table->dropColumn([
                'received_on',
                'cost_status',
                'supplier_invoice_ref',
                'invoice_date',
                'variance_note',
                'discount_amount',
                'tax_amount',
                'delivery_amount',
                'other_charges_amount',
                'invoice_total_amount',
            ]);
        });
    }
};
