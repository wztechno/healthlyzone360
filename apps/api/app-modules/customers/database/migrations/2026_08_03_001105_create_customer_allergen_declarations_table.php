<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "I react to this." One row per allergen class the customer declares.
 *
 * **The canonical code, never a typed word.** `allergen_code` points at the
 * platform's regulatory vocabulary (§4.6) with `restrictOnDelete`, so a
 * customer's declaration and a recipe's label are expressed in the same 14
 * identities and can be compared by equality. A free-text allergy field would
 * make "peanut", "peanuts" and "groundnut" three unrelated strings, and the
 * cross-check C1 performs at checkout would silently pass.
 *
 * **`severity` is recorded because avoidance and anaphylaxis are not the same
 * request.** A preference and a medical emergency both arrive through the same
 * form; a kitchen deciding whether "may contain" is acceptable needs to know
 * which one it is holding. The vocabulary stays short and non-clinical —
 * nothing here is a diagnosis, and none of these values may be presented as
 * one.
 *
 * `declared_at` is per row rather than inherited from the profile: allergies
 * are added over time, and "when did they tell us about sesame" is the
 * question an incident review asks.
 *
 * Special category throughout. Every staff-side read goes through
 * `DietaryProfileReader` with a purpose of use; there is no path that returns
 * these rows without one.
 *
 * Isolation strategy: **`join-rls-parent`** through
 * `customer_dietary_profiles` → `customer_accounts`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_allergen_declarations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_dietary_profile_id')->constrained('customer_dietary_profiles')->cascadeOnDelete();

            $table->string('allergen_code', 20);
            $table->string('severity', 20)->default('allergy')->comment('avoidance | intolerance | allergy | anaphylaxis — not a diagnosis');
            $table->text('notes')->nullable();
            $table->timestamp('declared_at');

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign('allergen_code')->references('code')->on('allergens')->restrictOnDelete();

            $table->unique(['customer_dietary_profile_id', 'allergen_code']);
        });

        DB::statement("ALTER TABLE customer_allergen_declarations ADD CONSTRAINT customer_allergen_declarations_severity_check CHECK (severity IN ('avoidance', 'intolerance', 'allergy', 'anaphylaxis'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_allergen_declarations');
    }
};
