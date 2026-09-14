<?php

declare(strict_types=1);

use Healthy360\Ingredients\Services\IngredientNutritionImporter;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the nutrition seeder last wrote onto this row, as a hash.
 *
 * `sha256(json_encode([nutrition_per_100g, grams_per_unit]))` — the two columns
 * the reference document owns, exactly as the seeder wrote them, hashed
 * together as one pair. {@see IngredientNutritionImporter::fingerprint()}
 * is the only thing that computes it, so the canonical form (object keys sorted,
 * the decimal cast applied) lives in one place rather than in every caller.
 *
 * ## What it is for
 *
 * One question, asked when a changed nutrition document has to be re-applied to
 * a database that already holds the old one: **has anybody edited this row since
 * we seeded it?** A row still holding exactly what the seeder wrote can be
 * rewritten safely — nothing is lost, because nothing was ever added. A row
 * whose figures somebody replaced with a supplier's label must not be, and that
 * distinction is not otherwise decidable: `updated_at` moves for a dozen
 * unrelated reasons, and there is no history table on `ingredients` to consult.
 * A hash of the two columns answers it exactly, in one `char(64)`, with no
 * second table and no audit trawl.
 *
 * ## Why a hash rather than a version number
 *
 * A version stamp ("seeded from document v3") says what the *file* was, not what
 * the *row* is. It stays truthful through a curated edit, because nothing about
 * the edit touches the stamp — which is precisely the case the column exists to
 * catch. A hash of the values themselves cannot lie about them: any edit, from
 * any path, by anybody, makes the stored hash stop matching, whatever the file
 * says and whoever wrote it. The catalogue service needs no knowledge of this
 * column and no hook, and an edit made with raw SQL is caught as surely as one
 * made through the API.
 *
 * ## NULL means "seeded before this column existed"
 *
 * The 306 platform rows on every deployed database were filled by a seeder that
 * had nothing to stamp. Their NULL is not a curation signal and must not read as
 * one. The next run stamps it — from the row's *current* values, and only when
 * those are still exactly what the document would write, so a row curated during
 * that window is recorded as the curated row it is rather than being blessed as
 * pristine. Nothing is rewritten to make this happen: stamping a fingerprint is
 * not a change to the facts, and it never marks a derivation stale.
 *
 * Nullable forever, for the same reason `grams_per_unit` is: a tenant's own
 * ingredient was never seeded and has nothing to fingerprint.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->char('nutrition_seed_fingerprint', 64)->nullable()
                ->comment('sha256 of the nutrition + density the seeder last wrote; NULL = never seeded, or seeded before this column');
        });
    }

    public function down(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->dropColumn('nutrition_seed_fingerprint');
        });
    }
};
