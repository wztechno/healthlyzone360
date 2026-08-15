<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Everything a kitchen sells, in one table with a discriminator: a retail
 * product, a meal, or a subscription plan.
 *
 * **One table, three kinds** (appendix D). The alternative — `products`,
 * `meals`, `subscription_plans` — was rejected because every consumer of a
 * sellable thing would then need three of everything: three price paths,
 * three availability tables, three publication gates, three ways to appear in
 * a basket. The parts that genuinely differ are the parts that are nullable
 * here (`recipe_id` is a meal's, `purchasing_unit_id` is a product's) plus
 * the child tables, and a kind-specific child is cheaper than a kind-specific
 * everything.
 *
 * **`status` is the SELLABLE family** — `draft | review_required | published |
 * retired` (master plan v2 §4.7), **not** the `active | archived` pair the
 * operational tables in this module use. A catalogue item is a thing a
 * customer can be shown, so it publishes, it quarantines, and it retires; it
 * never "archives". `review_required` is a stored quarantine inside the CHECK
 * for the same reason it is on `recipe_versions`: a critical allergen
 * contradiction must make publication structurally impossible, not decorate
 * the row with a flag a publish path can forget to read. Retirement is
 * terminal for consumer visibility and keeps the row, because an order or a
 * price snapshot may point at it forever.
 *
 * `slug` is immutable after creation (master plan v2 §4). A rename changes
 * `name_en`/`name_ar` and nothing else: a slug is what a link, a marketplace
 * listing and a partner's integration hold, and a system that lets it move
 * quietly is a system that breaks other people's bookmarks on a typo fix.
 *
 * `production_mode` records whether the kitchen makes this, buys it in, or
 * both — the source sheets' `Kind` column, verbatim in meaning if not in
 * spelling. `recipe_id` and `ingredient_id` are the two ways an item can be
 * *backed*: a meal points at a recipe, a resold raw good points at the
 * ingredient it is. Both are `nullOnDelete` — losing the link degrades a
 * label, and a catalogue row must never be the reason an ingredient cannot be
 * removed.
 *
 * `is_market_priced` and `is_assorted` are not price columns; they are facts
 * about the article that the pricing slice will *read*. Market-priced goods
 * carry no confirmed amount at all (appendix D, OD-2), and an assorted row
 * stands for a mixed selection rather than one article. **There are no cost,
 * margin or amount columns here, and there will not be**: money lives in
 * K1.5's `price_lists`, and the frontend contract's confidential
 * `marginPercent` is a computed presentation figure with no server-side home.
 *
 * `data_quality_flags` is a jsonb array of import findings the operator has
 * not resolved (`dual_pack_single_price`, `missing_b2b_price`). Deliberately
 * not a table: the values are a bag of strings a human reads and clears, and
 * the moment one of them needs its own workflow it earns its own row.
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope in K1.4**. No new
 * PostgreSQL policy: a catalogue item is published content — its name, its
 * description and its allergens are meant to reach a diner — and what is
 * genuinely confidential about a catalogue is the price, which is K1.5's
 * table and K1.5's decision.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalogue_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_id')->constrained('catalogues')->cascadeOnDelete();
            $table->string('item_type', 30)->comment('product | meal | subscription_plan');
            $table->string('slug', 140)->comment('immutable after creation — a rename changes names only');
            $table->string('name_en');
            $table->string('name_ar');
            $table->text('description_en')->nullable();
            $table->text('description_ar')->nullable();

            $table->foreignUuid('product_category_id')->nullable()->constrained('product_categories')->restrictOnDelete();
            $table->string('production_mode', 20)->nullable()->comment('production | supplier | both');
            $table->foreignUuid('recipe_id')->nullable()->constrained('recipes')->nullOnDelete();
            $table->foreignUuid('ingredient_id')->nullable()->constrained('ingredients')->nullOnDelete();
            $table->foreignUuid('purchasing_unit_id')->nullable()->constrained('measurement_units')->restrictOnDelete();
            $table->foreignUuid('usage_unit_id')->nullable()->constrained('measurement_units')->restrictOnDelete();

            $table->boolean('is_market_priced')->default(false);
            $table->boolean('is_assorted')->default(false);

            $table->string('status', 20)->default('draft')->comment('draft | review_required | published | retired — the SELLABLE family (master plan v2 §4.7)');
            $table->string('review_reason', 200)->nullable()->comment('why this item is quarantined');
            $table->string('image_placeholder_id', 80)->nullable();
            $table->jsonb('data_quality_flags')->nullable()->comment('unresolved import findings, e.g. ["dual_pack_single_price"]');

            $table->string('source_system', 40)->nullable();
            $table->string('source_ref', 160)->nullable();
            $table->timestamp('seeded_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique(['organisation_id', 'slug']);
            $table->index(['organisation_id', 'item_type', 'status']);
            $table->index(['catalogue_id', 'status']);
        });

        DB::statement("ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_item_type_check CHECK (item_type IN ('product', 'meal', 'subscription_plan'))");
        DB::statement("ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_status_check CHECK (status IN ('draft', 'review_required', 'published', 'retired'))");
        DB::statement("ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_production_mode_check CHECK (production_mode IS NULL OR production_mode IN ('production', 'supplier', 'both'))");

        // Re-importing the same source row must converge rather than
        // duplicate. Partial, and for the K1.1 reason: applied to the whole
        // tuple it would make every hand-created item — none of which claims a
        // source — collide with the next one.
        DB::statement('CREATE UNIQUE INDEX catalogue_items_organisation_id_source_unique ON catalogue_items (organisation_id, source_system, source_ref) WHERE source_system IS NOT NULL AND source_ref IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('catalogue_items');
    }
};
