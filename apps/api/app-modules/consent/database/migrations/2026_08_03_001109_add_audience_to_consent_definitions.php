<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Consent definitions learn who they are for, and whether they may be
 * declined.
 *
 * The foundation shipped three definitions and one implicit audience:
 * everybody. That held while the only actor was a staff member registering an
 * account. J1 adds a consumer set — age confirmation, health-data processing,
 * marketing — and the moment those exist, `pendingFor()` starts prompting a
 * kitchen's chef to confirm they are old enough to order food. The prompt is
 * wrong, and no amount of client-side filtering fixes it: the server is what
 * decides which consents apply to whom.
 *
 * **`audience`**: `all` (the platform texts everybody accepts), `d2c` (the
 * consumer journey), `b2b` (B1's buyer texts), `guest` (G1's reduced set). It
 * is a single value rather than a set because a text written for two audiences
 * is two texts — the consumer privacy notice and the corporate one differ in
 * substance — and because a set column would make "which consents does this
 * person owe" a containment query on every request.
 *
 * **`is_required`** separates a consent that gates a lifecycle from one that
 * is a genuine choice. Marketing must be declinable and default to off (G1's
 * rule, and the only defensible reading of consent); terms are not a choice
 * anybody can make and still hold an account. The activation evaluator reads
 * exactly this column, so "which consents block activation" has one answer in
 * one place.
 *
 * Backfill is `all` / not required, which is what the three existing
 * definitions are: terms and privacy really are for everybody, and health-data
 * processing is collected contextually rather than as an activation gate.
 * Marking any of them required here would change the meaning of grants already
 * recorded against them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('consent_definitions', function (Blueprint $table): void {
            $table->string('audience', 10)->default('all')->after('purpose')
                ->comment('all | d2c | b2b | guest — who is asked');
            $table->boolean('is_required')->default(false)->after('audience')
                ->comment('gates a lifecycle; marketing is never required');
            $table->integer('display_order')->default(0)->after('is_required');

            $table->index(['audience', 'is_active']);
        });

        DB::statement("ALTER TABLE consent_definitions ADD CONSTRAINT consent_definitions_audience_check CHECK (audience IN ('all', 'd2c', 'b2b', 'guest'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE consent_definitions DROP CONSTRAINT IF EXISTS consent_definitions_audience_check');

        Schema::table('consent_definitions', function (Blueprint $table): void {
            $table->dropIndex(['audience', 'is_active']);
            $table->dropColumn(['audience', 'is_required', 'display_order']);
        });
    }
};
