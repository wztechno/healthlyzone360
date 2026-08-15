<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The platform's delivery gazetteer — the named places a customer can give as
 * an address and a kitchen can agree to serve.
 *
 * **Platform-global, like `countries`.** No `organisation_id`, no
 * `created_by`, no `lock_version`: a place is not a tenant's opinion. Two
 * kitchens delivering to Achrafieh are delivering to the *same* Achrafieh, and
 * the moment each kitchen holds its own row the address a customer picked at
 * one kitchen stops being comparable with the one they picked at the other —
 * which is precisely the join J1's address validation and C1's checkout need.
 * What a kitchen *does* own is `delivery_zones`, one table over: its own
 * grouping of these areas, with its own fee and its own minimum order.
 *
 * `code` is unique **per country**, not globally. Place names repeat across
 * borders, and a gazetteer that had to disambiguate `hamra` for every future
 * market would end up with codes nobody could read. `(country_code, code)` is
 * the natural key an importer and a URL both use.
 *
 * **`region` stays NULL** (OD-12). The source workbook lists 125 zone names
 * under one heading — "Lebanon / Mount-Lebanon" — and does not say which name
 * belongs to which governorate. A grouping invented here would look exactly
 * like data and be wrong roughly half the time, so the column exists for the
 * day somebody with local knowledge fills it in and holds nothing until then.
 *
 * **Names are transcribed, never corrected.** `Beirut Airpot` is seeded with
 * the source's spelling and flagged in the data file (appendix D data-quality
 * finding 25). A silent correction is indistinguishable from a different
 * place, and the importer matches on what the source says.
 *
 * Withdrawal is `is_active = false`, never a delete: `delivery_zone_areas`
 * points here with `restrictOnDelete`, and an address recorded last year has
 * to stay resolvable.
 *
 * Isolation strategy: `platform-public-ref` — readable by everyone including
 * anonymous callers (`GET /reference/delivery-areas`), written only by a
 * platform operator.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_areas', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('country_code', 2);
            $table->string('code', 60)->comment('slug of the source name; unique within the country, never globally');
            $table->string('name_en');
            $table->string('name_ar');
            $table->string('region', 60)->nullable()->comment('governorate or district — deliberately unpopulated (OD-12); the source does not say');
            $table->integer('display_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->foreign('country_code')->references('code')->on('countries')->restrictOnDelete();

            $table->unique(['country_code', 'code']);
            $table->index(['country_code', 'is_active', 'display_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_areas');
    }
};
