<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The four fields the v6 ingredient master carries that the table lacked.
 *
 * `composition` is transcription, not formulation: the workbook's coarse
 * "Made From" text ("Sodium bicarbonate, acidity regulator, corn starch"),
 * shown in the kitchen UI. Quantified formulation stays in recipe lines.
 *
 * `purchase_unit_id` is the pack the kitchen buys in (the workbook's Type
 * column); `default_unit_id` remains the usage unit. `items_per_unit` counts
 * pieces per purchase pack where the source knows it, which is rarely.
 *
 * `nutrition_per_100g` uses the same jsonb facts envelope as
 * `catalogue_items.nutrition_facts` (basis/amounts/source/calculation, the
 * eight core nutrient ids), per-100 g. The v6 workbook records no nutrition,
 * so every row starts NULL — this is the landing zone for the later
 * recipe-rollup phase, not data anyone has yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->text('composition')->nullable()
                ->comment('Composition (Made From) — free transcription from the source workbook, kitchen-facing');
            $table->foreignUuid('purchase_unit_id')->nullable()
                ->constrained('measurement_units')->restrictOnDelete()
                ->comment('The pack this is bought in (workbook Type); default_unit_id stays the usage unit');
            $table->decimal('items_per_unit', 10, 2)->nullable()
                ->comment('Pieces per purchase pack; mostly unknown in the source');
            $table->jsonb('nutrition_per_100g')->nullable()
                ->comment('Per-100 g facts payload, same envelope as catalogue_items.nutrition_facts; NULL until recorded');
        });
    }

    public function down(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('purchase_unit_id');
            $table->dropColumn(['composition', 'items_per_unit', 'nutrition_per_100g']);
        });
    }
};
