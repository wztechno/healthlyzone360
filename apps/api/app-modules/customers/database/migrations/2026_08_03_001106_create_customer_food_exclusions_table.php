<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Not this, please." Dislikes and forbiddens, in one table instead of four.
 *
 * The legacy ERDs carry `Dislikes`, `Forbidden`, and two more of the same
 * shape (appendix D merge map). They are one concept with a discriminator: a
 * customer naming something they will not eat, and a reason that is either
 * preference or prohibition. Four tables meant four joins to answer one
 * question and four places to add the next reason.
 *
 * **Three ways to name the thing, exactly one per row.** An ingredient from
 * the master (`ingredient_id`) is the strong form and the only one C1 can
 * check mechanically. A diet classification (`diet_classification_id`) is the
 * broad form — "no pork", "vegetarian" — and covers what an ingredient list
 * cannot. Free text is the honest fallback for everything a customer says that
 * the platform has no identity for, and it is stored *as written* and never
 * matched against anything: a system that string-matched "no nuts" onto the
 * allergen vocabulary would be inventing a medical fact. The
 * `num_nonnulls(...) = 1` CHECK is what stops a row from being two of these at
 * once and therefore ambiguous about which one the kitchen must honour.
 *
 * **`kind` separates preference from prohibition** because a substitution
 * engine may override a dislike and must never override a forbidden. Allergies
 * are not here at all — they have their own table with their own severity, and
 * mixing them in would let an allergy be treated as a preference by a query
 * that forgot the discriminator.
 *
 * Special category: a religious or ethical prohibition is a belief, and this
 * table is read on the same purpose-of-use path as the declarations beside it.
 *
 * Isolation strategy: **`join-rls-parent`** through
 * `customer_dietary_profiles` → `customer_accounts`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_food_exclusions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_dietary_profile_id')->constrained('customer_dietary_profiles')->cascadeOnDelete();

            $table->string('kind', 20)->default('dislike')->comment('dislike (may be substituted) | forbidden (never may be)');

            $table->foreignUuid('ingredient_id')->nullable()->comment('the strong form — the only one a checkout can check mechanically')->constrained('ingredients')->cascadeOnDelete();
            $table->foreignUuid('diet_classification_id')->nullable()->comment('the broad form — vegetarian, no pork')->constrained('diet_classifications')->restrictOnDelete();
            $table->string('free_text', 120)->nullable()
                ->comment('stored as written, never matched against the allergen or ingredient vocabularies');

            $table->timestamp('declared_at');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['customer_dietary_profile_id', 'kind']);
        });

        DB::statement("ALTER TABLE customer_food_exclusions ADD CONSTRAINT customer_food_exclusions_kind_check CHECK (kind IN ('dislike', 'forbidden'))");

        // Exactly one subject. A row that named two would be ambiguous about
        // what the kitchen has to leave out.
        DB::statement('ALTER TABLE customer_food_exclusions ADD CONSTRAINT customer_food_exclusions_subject_check CHECK (num_nonnulls(ingredient_id, diet_classification_id, free_text) = 1)');

        // The two identified forms converge on re-entry; free text does not,
        // because two people writing the same words have not necessarily said
        // the same thing.
        DB::statement('CREATE UNIQUE INDEX customer_food_exclusions_ingredient_unique ON customer_food_exclusions (customer_dietary_profile_id, ingredient_id) WHERE ingredient_id IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX customer_food_exclusions_diet_unique ON customer_food_exclusions (customer_dietary_profile_id, diet_classification_id) WHERE diet_classification_id IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_food_exclusions');
    }
};
