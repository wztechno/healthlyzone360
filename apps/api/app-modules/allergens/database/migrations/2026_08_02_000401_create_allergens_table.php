<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The canonical allergen classes (master plan v2 §4.6).
 *
 * **Primary key exception.** Every other Healthy360 table has a UUIDv7
 * surrogate key (D-023). This one keys on `code`, and the exception is
 * deliberate: an allergen class is a regulatory identity, not a row the
 * platform owns. `gluten` means the same thing in a kitchen's mapping, in a
 * customer's declaration, in a frozen recipe label and in the frontend's
 * `AllergenCode` union — and it must keep meaning it after any migration,
 * export or re-import. Codes are never renamed and never deleted (a class is
 * deactivated instead), so the key is as stable as a surrogate would be while
 * making every referencing row self-describing in a food-safety context where
 * dereferencing a UUID to read a label is exactly the step that goes wrong.
 * The rule for future vocabularies stays the surrogate key; this is the
 * justified exception, not a precedent.
 *
 * Market metadata is carried per class rather than assumed: EU-14 and US
 * Big-9 are different lists, and coconut (a tree nut under US law only) and
 * sulphites (declarable above 10 ppm) are the two rows where the difference
 * has to be representable.
 *
 * Isolation strategy: `platform-public-ref` — readable by everyone including
 * anonymous callers, written only by a platform operator.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('allergens', function (Blueprint $table): void {
            $table->string('code', 20)->primary()->comment('canonical regulatory identity; never renamed, never deleted');
            $table->string('name_en');
            $table->string('name_ar');
            $table->text('description_en')->nullable();
            $table->text('description_ar')->nullable();
            $table->string('regulatory_ref', 20)->comment('source allergen-list reference, e.g. ALG-01');
            $table->boolean('is_eu_14');
            $table->boolean('is_us_big_9');
            $table->boolean('us_declaration_required')->default(false)->comment('declarable in the US above a threshold');
            $table->integer('us_threshold_ppm')->nullable()->comment('e.g. sulphites at 10 ppm');
            $table->integer('display_order');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        DB::statement('ALTER TABLE allergens ADD CONSTRAINT allergens_us_threshold_ppm_check CHECK (us_threshold_ppm IS NULL OR us_threshold_ppm > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('allergens');
    }
};
