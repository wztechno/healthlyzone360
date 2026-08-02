<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Where a customer's food goes — anchored to a platform area, never to a
 * sentence.
 *
 * **`delivery_area_id` is the whole point of this table.** The prototype asks
 * for a free-text address and decides whether a kitchen serves it by matching
 * strings, which means "Achrafieh", "Ashrafieh" and "achrafiye" are three
 * different places and a delivery promise is a spelling coincidence. Here the
 * customer picks an area from the platform gazetteer and the rest of the
 * address is detail *within* that area. `ZoneResolver` then answers "does this
 * kitchen serve it" with a join instead of a guess (through the
 * `AreaServiceLookup` port, so this module never learns that delivery zones
 * exist).
 *
 * `restrictOnDelete` on the area, matching `delivery_zone_areas`: an address
 * captured last year has to stay resolvable, so a gazetteer entry is withdrawn
 * with `is_active = false` and never removed.
 *
 * **One model for D2C and B2B.** A corporate delivery location is this row
 * with a b2b account on it (appendix D merge map). Two tables would duplicate
 * the area FK, the default rule and the validation, and B1 would then have to
 * choose which one a shared order ships to.
 *
 * `contact_point_id` is the number the courier calls, and it is a reference
 * rather than a copied string on purpose: a person who changes their phone
 * changes it once, and the verification state travels with it.
 *
 * `is_default` is enforced per type rather than per account — a customer has a
 * default delivery address *and* a default billing address, and one flag
 * across both would make the second one unsettable.
 *
 * Isolation strategy: **`join-rls-parent`** — reachable only through
 * `customer_accounts`, which carries the policy, and cascade-deleted with it.
 * No policy of its own, for the reason `recipe_version_lines`' siblings have
 * none: a child that cannot be reached without its parent inherits the
 * parent's protection, and a second policy would be a second place to get the
 * predicate wrong.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_addresses', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_account_id')->constrained('customer_accounts')->cascadeOnDelete();
            $table->string('address_type', 10)->default('delivery')->comment('delivery | billing');

            $table->foreignUuid('delivery_area_id')->comment('the platform gazetteer entry; never a free-text place name')->constrained('delivery_areas')->restrictOnDelete();

            $table->string('label', 40)->nullable()->comment('what the customer calls it — Home, Office');
            $table->string('line_one');
            $table->string('line_two')->nullable();
            $table->string('building', 120)->nullable();
            $table->string('floor', 40)->nullable();
            $table->string('apartment', 40)->nullable();
            $table->text('directions')->nullable()->comment('free text for the courier; never parsed, never matched against');
            $table->string('postal_code', 20)->nullable();

            $table->foreignUuid('contact_point_id')->nullable()->comment('the number the courier calls; a reference so a changed phone changes once')->constrained('contact_points')->nullOnDelete();

            $table->boolean('is_default')->default(false);

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->index(['customer_account_id', 'address_type']);
            $table->index('delivery_area_id');
        });

        DB::statement("ALTER TABLE customer_addresses ADD CONSTRAINT customer_addresses_address_type_check CHECK (address_type IN ('delivery', 'billing'))");

        DB::statement('CREATE UNIQUE INDEX customer_addresses_default_unique ON customer_addresses (customer_account_id, address_type) WHERE is_default');
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_addresses');
    }
};
