<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Why an order was closed with something still outstanding (§3.5).
 *
 * §3.5 allows a short delivery to be closed and requires "an explicit reason".
 * That reason needs a home, and the two obvious candidates were both wrong:
 *
 * - **appending to `notes`** would mix an operational remark printed on the
 *   supplier's sheet with an internal accounting decision, and would make the
 *   reason unqueryable and unremovable;
 * - **audit metadata alone** would put the explanation behind
 *   `audit.view_organisation`, so the person looking at the order — who can see
 *   `closed_at` and the shortfall right there on the screen — could read that it
 *   was closed short and not why.
 *
 * So it is a column: nullable, because only a closed-short order has one, and
 * every other route to `received` (every line fulfilled) genuinely has no reason
 * to give. The CHECK is the honest half of that — a reason may only exist on an
 * order that actually reached `received`, so a stray sentence cannot be attached
 * to a draft.
 *
 * `varchar(255)`, matching `purchase_order_lines.notes`: this is one sentence
 * about one decision ("supplier discontinued the 5 kg pack"), not a case file.
 *
 * `closed_at` already exists — the previous slice added it nullable and unused,
 * naming this one. Nothing else about the table changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table): void {
            $table->string('close_short_reason', 255)->nullable()->after('closed_at')->comment('why the rest of this order was written off — required when a short delivery is closed (§3.5)');
        });

        // A reason belongs only to an order somebody deliberately closed. Any
        // other status carrying one would be a sentence with nothing to explain.
        DB::statement("ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_close_short_reason_check CHECK (close_short_reason IS NULL OR status = 'received')");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_close_short_reason_check');

        Schema::table('purchase_orders', function (Blueprint $table): void {
            $table->dropColumn('close_short_reason');
        });
    }
};
