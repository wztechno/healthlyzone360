<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a catalogue item is made of, as a customer is told it — the "contains
 * chickpeas, tahini, lemon" line under a dish.
 *
 * **Not a formulation.** There are no quantities here and there will not be:
 * a recipe version's lines are the formulation, they are confidential, and a
 * table that carried both a public ingredient list and a quantity would be
 * one careless presenter away from publishing a competitor's shopping list.
 * This table answers a different question — which ingredients does a diner
 * need to know about — and it is deliberately impoverished.
 *
 * It is also the **allergen basis of last resort**. A meal backed by a
 * published recipe version derives its allergens from that version's frozen
 * label. A meal that is bought in, or assembled without a technical sheet,
 * has no such label, and these rows are what the derivation falls back to.
 * That is why the publish gate accepts either one: an item with neither has
 * no way to answer "what is in this", and silence is not a statement of
 * absence.
 *
 * `ingredient_id` is `restrictOnDelete` (OD-8, the `recipe_version_lines`
 * rule): a published item's ingredient list must not lose a row because
 * somebody tidied the master. The catalogue module's usage registry carries
 * the same rule one level up, so an archive attempt is refused with
 * `catalogue.in_use` rather than by a foreign-key error.
 *
 * `is_representative` marks the handful a listing shows — "chickpeas, tahini,
 * lemon" under a card, not all nineteen. `display_order` is the sequence the
 * kitchen chose, because the order ingredients are named in is a labelling
 * convention (descending by weight, in most regimes) and not something to
 * re-sort alphabetically.
 *
 * Isolation strategy: `join-rls-parent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogue_item_ingredients', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->cascadeOnDelete();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->restrictOnDelete();
            $table->boolean('is_representative')->default(false);
            $table->integer('display_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['catalogue_item_id', 'ingredient_id']);
            $table->index('ingredient_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('catalogue_item_ingredients');
    }
};
