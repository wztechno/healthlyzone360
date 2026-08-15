<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The thing a price actually points at — one pack of a product, or one
 * configuration of a subscription plan.
 *
 * **One pricing path** (appendix D). Packs and plan configurations are the
 * same shape from pricing's point of view: a named child of a sellable item
 * that a price list quotes an amount against. Modelling them as two tables
 * would give K1.5 two joins, two nullability stories and two ways to answer
 * "what does this cost"; `variant_type` keeps the difference where it belongs
 * — in which extension table carries the detail.
 *
 * `status` is `draft | active | archived` — **operational, not the sellable
 * family**, and that is the deliberate asymmetry with the parent item. A pack
 * is not separately published: publishing the 500 g jar while the 1 kg jar
 * stays in draft is not a state a kitchen wants, it is a state a kitchen ends
 * up in. Publication is a decision about the *article*; a variant is a way of
 * buying it.
 *
 * `is_default` gets a **partial unique index**, not a boolean anybody trusts.
 * "Which pack do we show first" must have exactly one answer or a listing
 * renders a coin toss, and a service that promises to unset the old default
 * before setting the new one is a promise that survives until the first
 * concurrent write.
 *
 * Isolation strategy: `join-rls-parent` — reachable only through an item,
 * cascade-deleted with it, with `organisation_id` denormalised so a future
 * policy can be evaluated without a join.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogue_item_variants', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->cascadeOnDelete();
            $table->string('variant_type', 30)->comment('pack | plan_configuration');
            $table->string('code', 60);
            $table->string('name_en')->nullable();
            $table->string('name_ar')->nullable();
            $table->boolean('is_default')->default(false);
            $table->string('status', 20)->default('active')->comment('draft | active | archived — a pack is not separately published');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique(['catalogue_item_id', 'code']);
        });

        DB::statement("ALTER TABLE catalogue_item_variants ADD CONSTRAINT catalogue_item_variants_variant_type_check CHECK (variant_type IN ('pack', 'plan_configuration'))");
        DB::statement("ALTER TABLE catalogue_item_variants ADD CONSTRAINT catalogue_item_variants_status_check CHECK (status IN ('draft', 'active', 'archived'))");

        // Exactly one default per item, enforced by PostgreSQL rather than by
        // a service remembering to clear the incumbent first.
        DB::statement('CREATE UNIQUE INDEX catalogue_item_variants_one_default_per_item ON catalogue_item_variants (catalogue_item_id) WHERE is_default');
    }

    public function down(): void
    {
        Schema::dropIfExists('catalogue_item_variants');
    }
};
