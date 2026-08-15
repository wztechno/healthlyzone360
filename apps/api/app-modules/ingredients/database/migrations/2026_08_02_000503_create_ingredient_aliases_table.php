<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The other names an ingredient answers to — supplier designations, kitchen
 * shorthand, transliterations, and the duplicate identifiers a source
 * workbook carried before de-duplication.
 *
 * `alias_normalised` is written by the model (lower-cased, trimmed, internal
 * whitespace collapsed) and is what lookups match on, so "  Olive   Oil " and
 * "olive oil" resolve to the same ingredient without a `LOWER()` scan. The
 * verbatim `alias` is kept because an unresolved designation report has to
 * quote what the source actually said.
 *
 * No `organisation_id`: an alias belongs to its ingredient and inherits that
 * row's visibility. Isolation strategy: `join-rls-parent` in vocabulary —
 * reached only through `ingredients`, cascade-deleted with it.
 *
 * Insert-only in practice (add/remove, never edit), so no `updated_at`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ingredient_aliases', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->cascadeOnDelete();
            $table->string('alias', 160)->comment('verbatim, as the source or the operator wrote it');
            $table->string('alias_normalised', 160)->comment('lower-cased, trimmed, whitespace collapsed; written by the model');
            $table->string('locale', 5)->nullable();
            $table->string('source_system', 40)->nullable();
            $table->string('source_ref', 160)->nullable();
            $table->timestamp('created_at')->nullable();

            $table->unique(['ingredient_id', 'alias_normalised']);
            $table->index('alias_normalised');
        });

        DB::statement("ALTER TABLE ingredient_aliases ADD CONSTRAINT ingredient_aliases_alias_normalised_check CHECK (alias_normalised <> '')");
    }

    public function down(): void
    {
        Schema::dropIfExists('ingredient_aliases');
    }
};
