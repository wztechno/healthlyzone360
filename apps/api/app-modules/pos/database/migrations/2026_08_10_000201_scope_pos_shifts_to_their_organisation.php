<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `pos_shifts` learns which organisation it belongs to.
 *
 * The table was the one member of the POS family without the column — its
 * siblings `pos_registers` and `pos_transactions` have carried
 * `organisation_id` since they were created — so `PosShift` could not use the
 * platform's organisation scope and `POST /catalogue/pos/sales` resolved a
 * shift id from *any* tenant. The sale that followed was written against the
 * caller's own organisation and the other kitchen's shift: a cross-tenant
 * write, not merely a cross-tenant read.
 *
 * **The value is derived, not chosen.** A shift exists at a register, a
 * register belongs to exactly one organisation, and the backfill copies that
 * across; no shift can be ambiguous, because none was ever created without a
 * register. The column is added nullable, backfilled, and only then made
 * `NOT NULL`, which is the three-step shape that survives a table with rows in
 * it.
 *
 * **No row-level-security policy, deliberately**, and the set stays pinned at
 * eleven (ADR-0007, `RlsTest`). A till shift is an operational marker — who
 * was at which counter and when — with no price, no formulation and no
 * personal data in it, and its parent `pos_registers` has no policy either, so
 * a policy here would guard the child of an unguarded row. It follows the
 * `carts`/`orders` precedent the commerce tables set: `app-scope`, enforced by
 * `BelongsToOrganisation` and named at every call site.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_shifts', function (Blueprint $table): void {
            $table->foreignUuid('organisation_id')->nullable()->after('id')
                ->constrained('organisations')->cascadeOnDelete();
        });

        DB::statement(
            'UPDATE pos_shifts SET organisation_id = pos_registers.organisation_id
             FROM pos_registers WHERE pos_registers.id = pos_shifts.pos_register_id'
        );

        DB::statement('ALTER TABLE pos_shifts ALTER COLUMN organisation_id SET NOT NULL');

        Schema::table('pos_shifts', function (Blueprint $table): void {
            $table->index(['organisation_id', 'closed_at']);
        });
    }

    public function down(): void
    {
        Schema::table('pos_shifts', function (Blueprint $table): void {
            $table->dropIndex(['organisation_id', 'closed_at']);
            $table->dropConstrainedForeignId('organisation_id');
        });
    }
};
