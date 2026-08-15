<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Purchasing gains its cost (INV1.1) — the whole point of the feature on the
 * input side. `goods_receipt_lines` carried a quantity and nothing else; now
 * each line records what was paid, and each receipt records who it was paid to.
 *
 * **Cost lives here, on the procurement side, never on the order.** The
 * `OrderArchitectureTest` fails the build if a `cost|supplier|…` column appears
 * on `orders`/`order_lines`; a goods receipt is the opposite table — it is the
 * kitchen's own record of buying stock, and this is exactly where a landed cost
 * belongs.
 *
 * Amounts are `decimal(18,6)` in **major** currency units (§4.4) and a monetary
 * value never exists without its currency — the line CHECK mirrors
 * `recipe_version_lines` one-for-one. `unit_id` on a line is the unit the price
 * is quoted per (price per kg, per litre, per piece); the receipt-posting
 * service converts it into the stock item's unit for the movement and into the
 * ingredient's default unit for the moving average.
 *
 * Suppliers gain a default currency and two contact fields — the minimum a
 * purchases ledger needs to name who was paid, kept deliberately tight (no
 * terms, no addresses, no purchase-order surface: those are not this slice).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('suppliers', function (Blueprint $table): void {
            $table->string('currency_code', 3)->nullable()->after('name_en')->comment('the currency this supplier usually invoices in');
            $table->string('contact_email', 160)->nullable()->after('currency_code');
            $table->string('contact_phone', 40)->nullable()->after('contact_email');

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        Schema::table('goods_receipts', function (Blueprint $table): void {
            $table->foreignUuid('supplier_id')->nullable()->after('branch_id')->constrained('suppliers')->nullOnDelete();
            $table->string('document_ref', 120)->nullable()->after('supplier_id')->comment('the supplier delivery note or invoice number, as written');
        });

        Schema::table('goods_receipt_lines', function (Blueprint $table): void {
            // The unit the price is quoted per; null means the stock item's own unit.
            $table->foreignUuid('unit_id')->nullable()->after('quantity')->constrained('measurement_units')->restrictOnDelete();
            $table->decimal('unit_price_amount', 18, 6)->nullable()->after('unit_id')->comment('major currency units per unit_id (§4.4)');
            $table->decimal('line_total_amount', 18, 6)->nullable()->after('unit_price_amount')->comment('quantity × unit_price, major units');
            $table->string('cost_currency_code', 3)->nullable()->after('line_total_amount');

            $table->foreign('cost_currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        // A monetary value without its currency is not a monetary value (§4.4).
        DB::statement('ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_cost_currency_check CHECK ((unit_price_amount IS NULL AND line_total_amount IS NULL) OR cost_currency_code IS NOT NULL)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE goods_receipt_lines DROP CONSTRAINT IF EXISTS goods_receipt_lines_cost_currency_check');

        Schema::table('goods_receipt_lines', function (Blueprint $table): void {
            $table->dropForeign(['cost_currency_code']);
            $table->dropConstrainedForeignId('unit_id');
            $table->dropColumn(['unit_price_amount', 'line_total_amount', 'cost_currency_code']);
        });

        Schema::table('goods_receipts', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('supplier_id');
            $table->dropColumn('document_ref');
        });

        Schema::table('suppliers', function (Blueprint $table): void {
            $table->dropForeign(['currency_code']);
            $table->dropColumn(['currency_code', 'contact_email', 'contact_phone']);
        });
    }
};
