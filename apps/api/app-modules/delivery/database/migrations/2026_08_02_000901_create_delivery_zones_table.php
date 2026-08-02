<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A kitchen's own grouping of platform delivery areas, with what it charges
 * to reach them and how long it says that takes.
 *
 * The two-level geography is the whole design. `delivery_areas` is the
 * platform gazetteer — the same Achrafieh for everybody, so an address
 * captured once is comparable everywhere. A **zone** is one kitchen's
 * commercial statement about a set of those areas: "Beirut inner, $3, $25
 * minimum, about 45 minutes". Two kitchens can serve the same area at
 * different prices without either of them owning the place, and a customer's
 * address never has to be re-entered because a kitchen redrew its map.
 *
 * **`branch_id` NULL means organisation-wide**, and a branch-scoped zone is
 * how one location overrides that. The precedence is `branch beats org-wide`
 * and it is resolved in `ZoneResolver::zoneFor()`, not here — see
 * `delivery_zone_areas` for the unique keys that make the two claims able to
 * coexist and the reason they must.
 *
 * `currency_code` sits on the zone rather than on the fee, for the reason the
 * price list uses one level up (§4.4): every amount in the row is denominated
 * in it, so `delivery_fee_minor` and `minimum_order_minor` are comparable by
 * construction and there is no cross-currency arithmetic to arch-test away.
 * Both amounts are **minor units**, like every other price in this system, and
 * both are **nullable** — a kitchen that has not decided its fee has not
 * decided it, and `0` would say "free delivery", which is a different and much
 * more expensive statement (OD-2, risk R9).
 *
 * `estimated_minutes` is a promise, not a measurement, and it is nullable for
 * the same reason.
 *
 * `status` is `active | inactive | archived` — the **operational** family, not
 * the sellable one. A zone is configuration, not published content: what
 * reaches a customer is whether their address can be delivered to, which is a
 * question about the zone that serves it rather than a lifecycle badge.
 * `inactive` is a temporary suspension ("we are not crossing the mountain this
 * week"); `archived` is terminal and its area claims are released.
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope** in K1.7. No
 * PostgreSQL policy joins the set here, and the reason is the K1.4 one: a
 * delivery zone is a customer-published fact. Where a kitchen delivers and
 * what it charges is printed on its own checkout page. Cross-organisation
 * isolation is proven by feature test at the application layer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_zones', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->uuid('branch_id')->nullable()->comment('NULL = organisation-wide; a branch row overrides it for that branch');
            $table->string('code', 40);
            $table->string('name_en');
            $table->string('name_ar');
            $table->string('currency_code', 3)->comment('ISO 4217 — both amounts on this row are denominated in it');
            $table->bigInteger('delivery_fee_minor')->nullable()->comment('minor units; NULL = nobody has set a fee, never "free"');
            $table->bigInteger('minimum_order_minor')->nullable()->comment('minor units; NULL = no minimum stated');
            $table->integer('estimated_minutes')->nullable()->comment('a promise, not a measurement');
            $table->string('status', 20)->default('active')->comment('active | inactive | archived — operational, never the sellable family');

            $table->string('source_system', 40)->nullable();
            $table->string('source_ref', 160)->nullable();
            $table->timestamp('seeded_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->foreign('branch_id')->references('id')->on('organisation_branches')->nullOnDelete();
            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();

            $table->unique(['organisation_id', 'code']);
            $table->index(['organisation_id', 'status']);
            $table->index(['organisation_id', 'branch_id']);
        });

        DB::statement("ALTER TABLE delivery_zones ADD CONSTRAINT delivery_zones_status_check CHECK (status IN ('active', 'inactive', 'archived'))");

        // Non-negative rather than positive: a kitchen that genuinely does not
        // charge for delivery says so with `0`, and that is a different
        // statement from the NULL that means nobody has decided.
        DB::statement('ALTER TABLE delivery_zones ADD CONSTRAINT delivery_zones_delivery_fee_minor_check CHECK (delivery_fee_minor IS NULL OR delivery_fee_minor >= 0)');
        DB::statement('ALTER TABLE delivery_zones ADD CONSTRAINT delivery_zones_minimum_order_minor_check CHECK (minimum_order_minor IS NULL OR minimum_order_minor >= 0)');

        // Strictly positive: a zone that takes zero minutes to reach is not a
        // delivery estimate, it is an empty field somebody filled in.
        DB::statement('ALTER TABLE delivery_zones ADD CONSTRAINT delivery_zones_estimated_minutes_check CHECK (estimated_minutes IS NULL OR estimated_minutes > 0)');

        // Re-importing the same source zone must converge rather than
        // duplicate. Partial for the K1.1 reason: applied to the whole tuple
        // it would make every hand-created zone — none of which claims a
        // source — collide with the next one.
        DB::statement('CREATE UNIQUE INDEX delivery_zones_organisation_id_source_unique ON delivery_zones (organisation_id, source_system, source_ref) WHERE source_system IS NOT NULL AND source_ref IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_zones');
    }
};
