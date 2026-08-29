<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The three kitchen-facing transcription fields the v6 workbook carries.
 *
 * `composition` is the sheet's "Recipe (Made From)" prose — a coarse,
 * kitchen-facing ingredient list, never a quantified formulation.
 *
 * `kitchen_category` / `kitchen_subcategory` are the sheet's nested Category /
 * Sub-Category pair — the kitchen's own filing system, displayed in the
 * kitchen preview. Deliberately text and not FKs: the source values are
 * ingredient-taxonomy-ish with local variants, and an honest transcription
 * beats a normalisation nobody asked for. The *customer-facing* shelf is a
 * different field entirely (`product_category_id`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->text('composition')->nullable()
                ->comment('Recipe (Made From) — free transcription from the source workbook, kitchen-facing');
            $table->string('kitchen_category', 120)->nullable()
                ->comment('Workbook Category — kitchen-preview classification, transcribed text, not a FK');
            $table->string('kitchen_subcategory', 120)->nullable()
                ->comment('Workbook Sub-Category — nested under kitchen_category');
        });
    }

    public function down(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->dropColumn(['composition', 'kitchen_category', 'kitchen_subcategory']);
        });
    }
};
