<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which diet patterns a catalogue item is sold as — the pivot behind
 * "vegetarian", "keto", "gluten-free" on a listing filter.
 *
 * A surrogate key and a denormalised `organisation_id` on a pure join table,
 * which looks like overhead and is not: every other child table in this
 * module carries both, the `join-rls-parent` strategy needs the organisation
 * column so a future policy can be evaluated without a join, and a composite
 * primary key would make this the one table whose rows cannot be addressed
 * the way every other row in the system is. Consistency here costs sixteen
 * bytes and buys one shape.
 *
 * `diet_classification_id` is `restrictOnDelete`: the vocabulary is platform
 * reference data and a classification that is in use is not one to remove.
 * Deactivating it (`is_active`) is the supported withdrawal, exactly as with
 * allergen classes.
 *
 * **A diet tag is a preference filter, never an allergen statement.**
 * `gluten_free` here means the kitchen sells this as part of a gluten-free
 * line; what the dish actually contains is the derived allergen set, computed
 * from a published recipe version's frozen label or from the item's own
 * ingredient rows. Nothing in this programme reads a diet tag to answer an
 * allergen question, and the two are never each other's evidence.
 *
 * Isolation strategy: `join-rls-parent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogue_item_diet_classifications', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->cascadeOnDelete();
            $table->foreignUuid('diet_classification_id')->constrained('diet_classifications')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['catalogue_item_id', 'diet_classification_id'], 'catalogue_item_diet_classifications_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('catalogue_item_diet_classifications');
    }
};
