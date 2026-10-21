<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ingredient barcodes (2026-10-21, docs/requirements/ingredient-barcodes-plan.md §4).
 *
 * A row says "in this kitchen, this GTIN is this ingredient, and one scan of it
 * is this much". A GTIN belongs to the brand owner, not to whoever sells it, so
 * there is no supplier column: the same can carries the same code from any
 * supplier. One ingredient holds many codes — one per brand and pack level.
 *
 * - `gtin` is the one normal form: fourteen digits, left-zero-padded, check
 *   digit verified by the service. `UNIQUE (organisation_id, gtin)` makes a
 *   code mean exactly one ingredient in a kitchen.
 * - `origin = 'system'` is a kitchen code: a GS1 Restricted Circulation Number,
 *   prefix `04`, which padded to fourteen digits is `004…`. The CHECK ties the
 *   two together, so the origin can never contradict the number, and the
 *   partial unique index gives an ingredient at most one kitchen code.
 * - `ingredient_id` may point at a **platform** ingredient: the barcode row is
 *   the kitchen's own, so platform-row immutability does not reach it.
 *
 * `ingredient_barcode_counters` mints kitchen codes. It only climbs, so deleting
 * a code — or the ingredient that held it — never frees its number for reuse: a
 * printed label outlives its row.
 *
 * **ADR-0007 isolation: organisation column, application-scoped, no RLS.** Both
 * tables carry `organisation_id` and are read through `BelongsToOrganisation`
 * (the counter only through the service's own statement). Their parents,
 * `ingredients` and `stock_items`, are application-scoped too, so RLS on this
 * child alone would protect nothing the parent leaves open.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ingredient_barcodes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->cascadeOnDelete();
            $table->char('gtin', 14)->comment('GTIN-14 normal form: left-zero-padded, check digit verified');
            $table->string('origin', 16)->comment('supplier = the producer\'s code; system = a kitchen code (RCN prefix 04)');
            $table->decimal('pack_quantity', 14, 4)->nullable()->comment('one scan of this code = this much of pack_unit_id');
            $table->foreignUuid('pack_unit_id')->nullable()->constrained('measurement_units')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['organisation_id', 'gtin']);
            $table->index('ingredient_id');
        });

        DB::statement("ALTER TABLE ingredient_barcodes ADD CONSTRAINT ingredient_barcodes_gtin_check CHECK (gtin ~ '^[0-9]{14}$')");
        DB::statement("ALTER TABLE ingredient_barcodes ADD CONSTRAINT ingredient_barcodes_origin_check CHECK (origin IN ('supplier', 'system'))");
        DB::statement("ALTER TABLE ingredient_barcodes ADD CONSTRAINT ingredient_barcodes_origin_range_check CHECK ((origin = 'system') = (gtin LIKE '004%'))");
        DB::statement('ALTER TABLE ingredient_barcodes ADD CONSTRAINT ingredient_barcodes_pack_check CHECK ((pack_quantity IS NULL) = (pack_unit_id IS NULL) AND (pack_quantity IS NULL OR pack_quantity > 0))');
        DB::statement("CREATE UNIQUE INDEX ingredient_barcodes_one_system_code ON ingredient_barcodes (organisation_id, ingredient_id) WHERE origin = 'system'");

        Schema::create('ingredient_barcode_counters', function (Blueprint $table): void {
            $table->foreignUuid('organisation_id')->primary()->constrained('organisations')->cascadeOnDelete();
            $table->bigInteger('last_value')->comment('the last kitchen-code number issued; never decreases');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ingredient_barcode_counters');
        Schema::dropIfExists('ingredient_barcodes');
    }
};
