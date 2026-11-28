<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The packaging one pack is made of: the bottle it is filled into, and the cap
 * and label added by hand.
 *
 * One row per packaging item per pack, so `(variant, ingredient)` is unique,
 * and at most one row is the container — the thing the pack is filled into,
 * whose capacity states the fill. "Which one is the bottle" must have one
 * answer, so it is a partial unique index rather than a promise.
 *
 * `ingredient_id` is `restrictOnDelete`: a pack whose bottle vanished is a pack
 * whose cost is unknown. The variant is `cascadeOnDelete`, because the
 * components are the pack's and mean nothing without it.
 *
 * Isolation strategy: `join-rls-parent` — reachable only through a pack
 * variant, cascade-deleted with it, the same treatment as
 * `catalogue_item_pack_variants`, with `organisation_id` denormalised so a
 * future policy can be evaluated without a join.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogue_item_pack_components', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_variant_id')->constrained('catalogue_item_variants')->cascadeOnDelete();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->restrictOnDelete();
            $table->decimal('quantity', 12, 4)->default(1)->comment('how many of the packaging item one pack uses');
            $table->boolean('is_container')->default(false)->comment('the component the pack is filled into; at most one per pack');
            $table->timestamps();

            $table->unique(['catalogue_item_variant_id', 'ingredient_id']);
        });

        DB::statement('ALTER TABLE catalogue_item_pack_components ADD CONSTRAINT catalogue_item_pack_components_quantity_check CHECK (quantity > 0)');
        DB::statement('CREATE UNIQUE INDEX catalogue_item_pack_components_one_container ON catalogue_item_pack_components (catalogue_item_variant_id) WHERE is_container');
    }

    public function down(): void
    {
        Schema::dropIfExists('catalogue_item_pack_components');
    }
};
