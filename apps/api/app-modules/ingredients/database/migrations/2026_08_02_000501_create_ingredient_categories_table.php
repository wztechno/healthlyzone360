<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Two-level ingredient classification (category → sub-category), modelled as
 * one self-referencing table rather than two: the source data has exactly two
 * levels today, but the shape of "Vegetables & other → Condiments / vinegars"
 * is the same shape at every depth, and a second table would have to be
 * merged back the first time a kitchen wants a third level.
 *
 * `organisation_id` NULL is the platform library: rows every tenant sees.
 * A tenant's own categories carry its identifier, and the unique index uses
 * NULLS NOT DISTINCT so the platform library cannot contain two rows with the
 * same code either.
 *
 * Isolation strategy: `org-rls` in vocabulary but **app-scope in K1** — the
 * PostgreSQL policy set is unchanged in this slice (appendix D matrix). The
 * `BelongsToOrganisation` scope with `organisationScopeAllowsNull()` true is
 * the `roles` pattern: platform rows visible in every tenant, tenant rows
 * visible only in their own. Cross-organisation isolation is proven by
 * feature test, not yet by a policy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ingredient_categories', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->nullable()->comment('null = platform library')->constrained('organisations')->cascadeOnDelete();
            $table->uuid('parent_id')->nullable()->index()->comment('null = top level');
            $table->string('code', 40);
            $table->string('name_en');
            $table->string('name_ar');
            $table->integer('display_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        // The self-reference is added after the table exists: a foreign key
        // declared inline would be emitted before the primary key it points
        // at, and PostgreSQL refuses a reference to a column that carries no
        // unique constraint yet.
        Schema::table('ingredient_categories', function (Blueprint $table): void {
            $table->foreign('parent_id')->references('id')->on('ingredient_categories')->cascadeOnDelete();
        });

        DB::statement('ALTER TABLE ingredient_categories ADD CONSTRAINT ingredient_categories_organisation_id_code_unique UNIQUE NULLS NOT DISTINCT (organisation_id, code)');
    }

    public function down(): void
    {
        Schema::dropIfExists('ingredient_categories');
    }
};
