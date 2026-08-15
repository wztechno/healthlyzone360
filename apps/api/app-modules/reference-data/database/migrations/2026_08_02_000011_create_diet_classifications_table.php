<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How a person describes the pattern of what they eat — the platform's diet
 * vocabulary, and the thing a catalogue item is tagged with so a customer can
 * filter by it.
 *
 * **Reference data, not catalogue data**, which is why it lives here rather
 * than in the catalogues module. Kitchens tag against this vocabulary; nobody
 * inside a tenant invents a value. A kitchen that could add "keto-ish" would
 * make the customer-side filter meaningless the first time two kitchens spelt
 * the same idea differently — the same argument that keeps allergen classes
 * platform-owned (master plan v2 §4.6), applied to a vocabulary with less at
 * stake and the same failure mode.
 *
 * **Surrogate key, not a code primary key.** The allergen table's `code` PK is
 * the justified exception it says it is: an allergen class is a regulatory
 * identity that must stay self-describing in a food-safety context. A diet
 * classification is a marketing filter — nobody is harmed by dereferencing a
 * UUID to read "pescatarian" — so this table follows the house rule (D-023)
 * with `code` as a unique key beside it.
 *
 * A classification is a **preference filter, never a medical restriction**.
 * `gluten_free` here says "this is sold as a gluten-free line"; what a dish
 * actually contains is the allergen label on its recipe version, derived from
 * ingredient mappings and frozen at publication. The two are never each
 * other's evidence, and no code in this programme reads a diet tag to answer
 * an allergen question.
 *
 * Isolation strategy: `platform-public-ref` — readable by everyone including
 * anonymous callers (`GET /reference/diet-classifications`), written only by
 * a platform operator.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('diet_classifications', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('code', 40)->unique()->comment('the platform vocabulary, matching the frontend DIET_CLASSIFICATIONS union 1:1');
            $table->string('name_en');
            $table->string('name_ar');
            $table->integer('display_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('diet_classifications');
    }
};
