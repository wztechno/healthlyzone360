<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The kitchen-written plan menu is retired: customers choose every meal of
 * every delivery day themselves (owner decision, 2026-10-28), so a plan no
 * longer states which dish it serves on which day of a cycle.
 *
 * The rows the menu already turned into `kitchen_default` meal choices stay —
 * they are the record of what was sent — and only the menu itself goes.
 * `down()` restores the empty shape; the entries are not recoverable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('plan_menu_entries');

        DB::statement('ALTER TABLE subscription_plan_profiles DROP CONSTRAINT IF EXISTS subscription_plan_profiles_menu_cycle_days_check');

        Schema::table('subscription_plan_profiles', function (Blueprint $table): void {
            $table->dropColumn(['menu_cycle_days', 'menu_cycle_anchor_date']);
        });
    }

    public function down(): void
    {
        Schema::create('plan_menu_entries', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->cascadeOnDelete();
            $table->smallInteger('cycle_day');
            $table->string('slot', 20);
            $table->smallInteger('sequence')->default(1);
            $table->foreignUuid('meal_catalogue_item_id')->constrained('catalogue_items')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['catalogue_item_id', 'cycle_day', 'slot', 'sequence'], 'plan_menu_entries_one_per_slot');
            $table->index(['organisation_id', 'catalogue_item_id']);
        });

        DB::statement('ALTER TABLE plan_menu_entries ADD CONSTRAINT plan_menu_entries_cycle_day_check CHECK (cycle_day > 0)');
        DB::statement("ALTER TABLE plan_menu_entries ADD CONSTRAINT plan_menu_entries_slot_check CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack'))");
        DB::statement('ALTER TABLE plan_menu_entries ADD CONSTRAINT plan_menu_entries_sequence_check CHECK (sequence > 0)');

        Schema::table('subscription_plan_profiles', function (Blueprint $table): void {
            $table->smallInteger('menu_cycle_days')->nullable();
            $table->date('menu_cycle_anchor_date')->nullable();
        });

        DB::statement('ALTER TABLE subscription_plan_profiles ADD CONSTRAINT subscription_plan_profiles_menu_cycle_days_check CHECK (menu_cycle_days IS NULL OR menu_cycle_days > 0)');
    }
};
