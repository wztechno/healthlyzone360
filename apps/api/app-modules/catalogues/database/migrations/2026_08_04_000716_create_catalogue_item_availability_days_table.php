<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-day availability for meal catalogue items.
 *
 * A row says whether one meal is offered on one calendar date, how many
 * portions remain, and when orders close. Its absence after a replace-all
 * write means the kitchen is not selling that meal on that date.
 *
 * Isolation strategy: `join-rls-parent` — denormalised `organisation_id`
 * with a foreign key to the parent catalogue item.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogue_item_availability_days', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->cascadeOnDelete();
            $table->date('date');
            $table->boolean('is_available')->default(true);
            $table->integer('remaining_portions')->nullable();
            $table->time('order_cut_off_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['catalogue_item_id', 'date']);
            $table->index(['catalogue_item_id', 'date', 'is_available']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('catalogue_item_availability_days');
    }
};
