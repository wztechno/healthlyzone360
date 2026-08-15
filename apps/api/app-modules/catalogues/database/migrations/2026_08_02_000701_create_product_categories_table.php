<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * How a kitchen files what it *sells* — poultry, sauces, bread, dairy.
 *
 * Deliberately not `ingredient_categories`. The two vocabularies look alike
 * and are not the same question: an ingredient category answers "where does
 * this raw material live in the store cupboard" (62 nodes, two levels,
 * purchasing-shaped), while this answers "which shelf of the shop is this on"
 * (ten nodes, flat, merchandising-shaped). Sharing one table would force
 * every ingredient sub-category into the customer's browse tree and would
 * make the first divergence — and there will be one, because purchasing and
 * merchandising never agree for long — a migration instead of a row.
 *
 * Flat, with no `parent_id`. The source catalogue has one level and a
 * self-reference nobody uses is a join everybody pays for; K1.8 or the
 * marketplace slice can add depth when a real two-level browse exists.
 *
 * `organisation_id` NULL is the platform library — the ten seeded rows every
 * kitchen sees — and a tenant's own categories carry its identifier. The
 * unique index uses NULLS NOT DISTINCT so the library cannot contain two rows
 * with the same code either (the `ingredient_categories` pattern).
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope in K1.4** — no new
 * PostgreSQL policy is added by this slice (appendix D). A category name is
 * published content: what is confidential about a catalogue is its price, and
 * prices are K1.5's tables.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_categories', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->nullable()->comment('null = platform library')->constrained('organisations')->cascadeOnDelete();
            $table->string('code', 40);
            $table->string('name_en');
            $table->string('name_ar');
            $table->integer('display_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        DB::statement('ALTER TABLE product_categories ADD CONSTRAINT product_categories_organisation_id_code_unique UNIQUE NULLS NOT DISTINCT (organisation_id, code)');
    }

    public function down(): void
    {
        Schema::dropIfExists('product_categories');
    }
};
