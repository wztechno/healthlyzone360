<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which delivery windows each zone offers.
 *
 * Windows stay an organisation-wide *vocabulary* — one "Morning", one code —
 * but the van that runs the morning slot does not necessarily cross the
 * mountain. A window not assigned to a zone is not offered to an address in
 * that zone, and placement refuses it (`window_not_offered`). Subscription
 * generation is exempt: a standing subscriber is not refused retroactively by
 * a map edit.
 *
 * Replaced as a set under the **zone's** `lock_version`, exactly as
 * `delivery_zone_areas` is, so there is no per-row version and no
 * `updated_at` — a row is either present or it is not.
 *
 * **Backfill: every existing zone offers every currently active window of its
 * organisation.** Before this table existed every window was offered
 * everywhere, so that is the only backfill that changes nothing a customer
 * sees. Inactive windows are left out; re-activating one later does not make
 * it reappear anywhere until a kitchen assigns it. A window created after this
 * migration starts in no zone.
 *
 * Isolation strategy: `join-rls-parent`, as `delivery_zone_areas` — reached
 * through a zone, cascade-deleted with either parent, carrying
 * `organisation_id` so a policy could be evaluated directly.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_zone_windows', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('delivery_zone_id')->constrained('delivery_zones')->cascadeOnDelete();
            $table->foreignUuid('delivery_window_id')->constrained('delivery_windows')->cascadeOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->unique(['delivery_zone_id', 'delivery_window_id']);
            $table->index(['organisation_id', 'delivery_window_id']);
        });

        DB::statement(<<<'SQL'
            INSERT INTO delivery_zone_windows (id, organisation_id, delivery_zone_id, delivery_window_id, created_at)
            SELECT gen_random_uuid(), z.organisation_id, z.id, w.id, now()
            FROM delivery_zones z
            JOIN delivery_windows w ON w.organisation_id = z.organisation_id AND w.is_active
            ON CONFLICT DO NOTHING
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_zone_windows');
    }
};
