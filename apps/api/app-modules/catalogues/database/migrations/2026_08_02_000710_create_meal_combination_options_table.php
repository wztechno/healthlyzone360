<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which meals of the day a subscription plan delivers — "lunch and dinner",
 * "breakfast only", "all three".
 *
 * **A kitchen's vocabulary, not the platform's.** One kitchen sells
 * breakfast/lunch/dinner, another sells lunch and dinner and calls the pair
 * "full board", and a shared library would have to be the union of everybody's
 * marketing. So `organisation_id` is NOT NULL — the same argument
 * `sales_channels` makes — and the platform seeds nothing here.
 *
 * The three booleans and `meals_per_day` are **both** stored, deliberately, and
 * they are not the same fact. The booleans say *which* sittings are covered,
 * which is what a customer reads and what a kitchen's production plan needs;
 * `meals_per_day` says *how many portions leave the kitchen*, which is what a
 * price per day is quoted against. They agree for the ordinary combinations
 * and stop agreeing the moment a kitchen sells "lunch, twice" — and inferring
 * the count from the flags would make that unrepresentable rather than merely
 * unusual.
 *
 * **Deactivated, never deleted.** A plan variant points at a combination, and
 * an order will point at that variant; `is_active` is the withdrawal, and the
 * `restrictOnDelete` on `plan_variant_profiles.meal_combination_option_id` is
 * the backstop that makes it the only one.
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope in K1.6** — the
 * PostgreSQL policy set is unchanged by this slice (appendix D).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('meal_combination_options', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('code', 40);
            $table->string('name_en');
            $table->string('name_ar');
            $table->boolean('includes_breakfast')->default(false);
            $table->boolean('includes_lunch')->default(false);
            $table->boolean('includes_dinner')->default(false);
            $table->integer('meals_per_day')->comment('portions leaving the kitchen per day — not inferred from the flags, so "lunch, twice" stays representable');
            $table->integer('display_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['organisation_id', 'code']);
            $table->index(['organisation_id', 'is_active']);
        });

        DB::statement('ALTER TABLE meal_combination_options ADD CONSTRAINT meal_combination_options_meals_per_day_check CHECK (meals_per_day > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('meal_combination_options');
    }
};
