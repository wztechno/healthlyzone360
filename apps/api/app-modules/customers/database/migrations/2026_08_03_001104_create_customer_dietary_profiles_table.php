<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a customer eats, will not eat, and cannot eat — the D2C subset only.
 *
 * **This is not a clinical record.** The source's Patient journey does not
 * exist (A-012) and the clinical block is deferred to CL1; what lives here is
 * the part a person states about themselves when ordering food. Nothing here
 * is diagnosis, medication or a practitioner's note, and CL1 is where that
 * conversation happens with the regulatory review it needs.
 *
 * **`declared_at` is the column the activation evaluator reads, and it is not
 * a boolean.** "Has this person answered the allergy question" and "does this
 * person have allergies" are different facts, and a schema with only the
 * second cannot tell an unanswered question from a confident no. So:
 * `declared_at` NULL means nobody has asked or nobody has answered;
 * `declared_at` set with `declares_no_allergens = true` is a person saying "I
 * have none", which is an answer and a safety-relevant one. The allergen rows
 * hanging off this profile are the third case.
 *
 * `religious_requirement` is **special category** and is why this table's
 * staff reads go through `DietaryProfileReader`, which records a purpose of
 * use on every one (06-security-privacy-and-audit.md §3.3). A belief inferred
 * from a food restriction is still a belief.
 *
 * One profile per account, enforced by a unique FK rather than by convention:
 * two profiles would mean two answers to "is this person allergic to peanuts",
 * and the reader would have to pick one.
 *
 * Isolation strategy: **`join-rls-parent`** through `customer_accounts`,
 * cascade-deleted with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_dietary_profiles', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_account_id')->unique()->constrained('customer_accounts')->cascadeOnDelete();

            $table->timestamp('declared_at')->nullable()
                ->comment('when the person answered — NULL is an unanswered question, not an absence of allergies');
            $table->boolean('declares_no_allergens')->default(false)
                ->comment('an explicit "I have none"; only meaningful together with declared_at');

            $table->foreignUuid('diet_classification_id')->nullable()->comment('the platform vocabulary the frontend already speaks')->constrained('diet_classifications')->restrictOnDelete();

            $table->string('religious_requirement', 60)->nullable()
                ->comment('special category — read only through DietaryProfileReader, which records a purpose of use');
            $table->text('notes')->nullable()->comment('the person own words; never parsed into rules');

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();
        });

        // "I have none" is only a statement if somebody made it.
        DB::statement('ALTER TABLE customer_dietary_profiles ADD CONSTRAINT customer_dietary_profiles_declaration_check CHECK (NOT declares_no_allergens OR declared_at IS NOT NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_dietary_profiles');
    }
};
