<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which platform areas a kitchen's zone covers — the join that turns "this
 * customer lives in Mtayleb" into "so delivery costs $3 and takes 45 minutes".
 *
 * **Two unique keys, and the second one is the rule.**
 *
 * `UNIQUE (delivery_zone_id, delivery_area_id)` is the boring one: an area
 * appears in a zone at most once.
 *
 * `UNIQUE (organisation_id, branch_id, delivery_area_id) NULLS NOT DISTINCT`
 * is the master-plan rule — **one area is served by one zone per branch** —
 * and it is the reason `branch_id` is denormalised onto this row at all. A
 * unique index cannot reach through a join to read the zone's branch, so the
 * zone's scope is copied here at write time and kept in step by the service
 * (the `plan_variant_profiles.catalogue_item_id` argument, one module over).
 *
 * The `NULLS NOT DISTINCT` is doing precise work, and what it *permits* is as
 * deliberate as what it forbids:
 *
 * - two **organisation-wide** zones cannot both claim Mtayleb — both rows
 *   carry `branch_id NULL`, and under `NULLS NOT DISTINCT` that is one value
 *   colliding with itself. Under PostgreSQL's default semantics it would not
 *   be, and an org could quietly hold two contradictory answers to "what does
 *   delivery here cost";
 * - two zones scoped to the **same branch** cannot both claim it, for the same
 *   reason;
 * - an organisation-wide zone and a **branch-scoped** zone *can* both claim
 *   it, and that is the override mechanism rather than a hole. `NULL` and a
 *   branch identifier are genuinely different values. A kitchen states a
 *   default map once and lets one location say "we also go to Mtayleb, but it
 *   is $6 from here".
 *
 * That last case makes the resolution order load-bearing rather than
 * decorative, so it is written down in exactly one place —
 * `ZoneResolver::zoneFor($area, $branch)` — and it is **branch beats
 * org-wide**: the more specific claim wins, and a delivery quoted with no
 * branch in context sees only the organisation-wide map. J1's address
 * validation calls that resolver rather than re-deriving the rule, because two
 * implementations of a precedence are two precedences.
 *
 * `delivery_area_id` is `restrictOnDelete`: withdrawing a place from the
 * gazetteer while kitchens still serve it would silently unpick their maps.
 * The gazetteer deactivates instead. `delivery_zone_id` cascades — the rows
 * are the zone's own body, meaningless without it.
 *
 * No `lock_version`: the set is replaced as a whole under the **zone's**
 * validator, so a per-row version would let two editors replace different
 * halves of one map.
 *
 * Isolation strategy: `join-rls-parent` — reached only through a zone,
 * cascade-deleted with it, carrying `organisation_id` so a policy above it
 * could be evaluated directly if the parent ever takes one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_zone_areas', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('delivery_zone_id')->constrained('delivery_zones')->cascadeOnDelete();
            $table->foreignUuid('delivery_area_id')->constrained('delivery_areas')->restrictOnDelete();
            $table->uuid('branch_id')->nullable()
                ->comment("denormalised from the zone at write time — a unique index cannot read the parent's branch");
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign('branch_id')->references('id')->on('organisation_branches')->nullOnDelete();

            $table->unique(['delivery_zone_id', 'delivery_area_id']);
            $table->index(['organisation_id', 'delivery_area_id']);
        });

        // One area → one zone per branch. NULLS NOT DISTINCT makes the
        // organisation-wide scope a value of its own, so org-wide claims
        // collide with each other while a branch claim legitimately coexists
        // with the org-wide one it overrides.
        DB::statement('ALTER TABLE delivery_zone_areas ADD CONSTRAINT delivery_zone_areas_branch_area_unique UNIQUE NULLS NOT DISTINCT (organisation_id, branch_id, delivery_area_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_zone_areas');
    }
};
