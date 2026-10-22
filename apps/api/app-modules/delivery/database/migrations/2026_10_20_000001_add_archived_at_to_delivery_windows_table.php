<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Archiving a delivery window.
 *
 * There is still no DELETE: an order taken for the evening slot has to stay
 * explainable, and past orders and subscriptions name their window by code.
 * But `is_active = false` alone left every withdrawn window on the kitchen's
 * list for good — including one saved with the name "." — with no way to tidy
 * it away. `archived_at` is that tidy-away: the window leaves the admin list
 * and every zone, and stays readable to whatever already points at it.
 *
 * An archived window is always inactive. The CHECK makes that a fact rather
 * than a habit, so every reader that already skips inactive windows — the
 * checkout, the order desk, the storefront — skips archived ones without being
 * told about them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_windows', function (Blueprint $table): void {
            $table->timestamp('archived_at')->nullable()->after('is_active');
        });

        DB::statement(<<<'SQL'
            ALTER TABLE delivery_windows
                ADD CONSTRAINT delivery_windows_archived_inactive_check
                CHECK (archived_at IS NULL OR is_active = false)
        SQL);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE delivery_windows DROP CONSTRAINT IF EXISTS delivery_windows_archived_inactive_check');

        Schema::table('delivery_windows', function (Blueprint $table): void {
            $table->dropColumn('archived_at');
        });
    }
};
