<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a delivery was against the last price, and what is still owed for it.
 *
 * **On the line: the last price it was compared with, and the difference.** The
 * last price itself stays derived (`LastPurchasePriceQuery`). These two are what
 * was true when the line was priced, so an approval reads what the approver was
 * shown even after later deliveries move the last price on.
 *
 * **On the receipt: the due date, the approval and the payment.** One payment for
 * one receipt, with no part payments.
 *
 * `payment_status` is `unpaid`, `paid` or `not_tracked`. Every receipt already on
 * file becomes `not_tracked`, or the first payables list would claim the kitchen
 * owes for everything it ever bought. A direct market purchase with no supplier is
 * `not_tracked` too: it was paid on the day.
 *
 * `suppliers.payment_due_days` is the number the free-text `payment_terms` could
 * never be computed from. Null means no due date is worked out.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('goods_receipt_lines', function (Blueprint $table): void {
            $table->decimal('last_unit_price_amount', 18, 6)->nullable()->comment('the last price paid, at the moment this line was priced');
            $table->decimal('price_variance_percent', 10, 2)->nullable()->comment('this price against it; null when the two cannot be compared');
        });

        Schema::table('goods_receipts', function (Blueprint $table): void {
            $table->date('due_on')->nullable();
            $table->string('payment_status', 16)->default('unpaid');
            $table->timestampTz('paid_at')->nullable();
            $table->foreignUuid('paid_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('paid_reference', 120)->nullable();
            $table->string('price_approval_status', 16)->nullable()->comment('null when nothing needed it; pending | approved');
            $table->foreignUuid('price_approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('price_approved_at')->nullable();
        });

        DB::statement("ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_payment_status_check CHECK (payment_status IN ('unpaid', 'paid', 'not_tracked'))");
        DB::statement("ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_price_approval_check CHECK (price_approval_status IS NULL OR price_approval_status IN ('pending', 'approved'))");
        DB::statement("UPDATE goods_receipts SET payment_status = 'not_tracked'");
        DB::statement("CREATE INDEX goods_receipts_payables_idx ON goods_receipts (organisation_id, due_on) WHERE payment_status = 'unpaid'");

        Schema::table('suppliers', function (Blueprint $table): void {
            $table->unsignedSmallInteger('payment_due_days')->nullable()->comment('days after the invoice a delivery falls due, 0-365');
        });

        DB::statement('ALTER TABLE suppliers ADD CONSTRAINT suppliers_payment_due_days_check CHECK (payment_due_days IS NULL OR payment_due_days <= 365)');
    }

    public function down(): void
    {
        Schema::table('suppliers', function (Blueprint $table): void {
            $table->dropColumn('payment_due_days');
        });

        DB::statement('DROP INDEX IF EXISTS goods_receipts_payables_idx');
        DB::statement('ALTER TABLE goods_receipts DROP CONSTRAINT IF EXISTS goods_receipts_payment_status_check');
        DB::statement('ALTER TABLE goods_receipts DROP CONSTRAINT IF EXISTS goods_receipts_price_approval_check');

        Schema::table('goods_receipts', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('paid_by');
            $table->dropConstrainedForeignId('price_approved_by');
            $table->dropColumn(['due_on', 'payment_status', 'paid_at', 'paid_reference', 'price_approval_status', 'price_approved_at']);
        });

        Schema::table('goods_receipt_lines', function (Blueprint $table): void {
            $table->dropColumn(['last_unit_price_amount', 'price_variance_percent']);
        });
    }
};
