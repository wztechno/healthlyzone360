<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->jsonb('nutrition_source')->nullable();
            $table->boolean('allergen_review_required')->default(false);
            $table->uuid('allergens_reviewed_by')->nullable();
            $table->timestampTz('allergens_reviewed_at')->nullable();
            $table->text('allergens_review_evidence')->nullable();
        });
        Schema::table('ingredient_allergens', function (Blueprint $table): void {
            $table->uuid('reviewed_by')->nullable();
            $table->timestampTz('reviewed_at')->nullable();
            $table->text('review_evidence')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('ingredients', fn (Blueprint $table) => $table->dropColumn(['nutrition_source', 'allergen_review_required', 'allergens_reviewed_by', 'allergens_reviewed_at', 'allergens_review_evidence']));
        Schema::table('ingredient_allergens', fn (Blueprint $table) => $table->dropColumn(['reviewed_by', 'reviewed_at', 'review_evidence']));
    }
};
