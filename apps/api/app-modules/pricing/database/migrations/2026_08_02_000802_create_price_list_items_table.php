<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One price, for one pricing point, over one interval of time.
 *
 * **Effective-dated supersession, never an update in place.** A price is
 * evidence: an order taken last March was taken at last March's price, and a
 * schema that lets a kitchen edit the number afterwards cannot reconstruct
 * what the customer was actually charged. So a change closes the standing row
 * (`effective_to` is set, `superseded_by_id` points at its replacement) and
 * inserts a new one. Nothing here is ever mutated or deleted by the API; the
 * only writes are "close this" and "open that".
 *
 * `effective_to` is **exclusive**: the row was in effect for
 * `[effective_from, effective_to)`. That is forced rather than chosen. A
 * replacement made today closes the incumbent at today and opens its successor
 * at today, so an inclusive end would leave two rows both claiming to be the
 * price on the day of the change — the one ambiguity this table exists to
 * remove. A row changed twice in one day therefore leaves a zero-length
 * interval behind, which is honest: that price never governed a whole day, and
 * the history still records that somebody stated it. (`price_lists.valid_from
 * / valid_to`, which a *human* writes, are inclusive; see that migration.)
 *
 * **The open row is the current one**, identified by `effective_to IS NULL`,
 * and the partial unique index below is what makes "the current price of this
 * point" a single-valued question. `NULLS NOT DISTINCT` matters as much as the
 * partiality: a variant-less row and a tier-less row both carry NULLs, and
 * under PostgreSQL's default NULL semantics the same pricing point could be
 * opened any number of times.
 *
 * **`price_status` and the amount are one fact, and the CHECK says so.**
 *   - `confirmed` — a real number a kitchen stands behind. Amount NOT NULL.
 *   - `placeholder` — the source had no price and nobody has supplied one.
 *     Amount NULL, and **never public** (user-confirmed decision OD-2, risk
 *     R9): a placeholder rendered as a price is a lie with a currency symbol
 *     on it, and a placeholder rendered as `0` is a worse one.
 *   - `market_priced` — the article is quoted at the time of sale (the
 *     appendix D "market-priced → NULL-amount row" finding). Amount NULL, and
 *     the absence is the statement rather than a gap in the data.
 *
 * The CHECK is written as an equality of two booleans — `(status =
 * 'confirmed') = (amount IS NOT NULL)` — so it refuses both failures at once:
 * a confirmed row with no number, and a placeholder carrying one. Enforced by
 * PostgreSQL rather than by a service, because the whole value of the honest
 * badge is that no import, no backfill and no future writer can produce the
 * combination. That the amount must also be *positive* is a service rule
 * rather than a constraint: zero is a number somebody might one day legitimately
 * mean, and the day they do it should be a product decision, not a migration.
 *
 * `unit_amount_minor` is `bigint` in **minor units** with the currency on the
 * parent list (§4.4). No floats, no decimals, no per-row currency — an amount
 * is a count of the smallest unit the currency has, which is what a payment
 * processor, an invoice and an order line all agree on.
 *
 * `min_quantity` is the tier threshold and is NULL for the base price. A row
 * applies from its threshold upwards, and the resolver picks the highest
 * threshold at or below the quantity asked for — so "10 or more" and "50 or
 * more" are two rows of one pricing point rather than two prices in conflict.
 *
 * `catalogue_item_id` and `catalogue_item_variant_id` are `restrictOnDelete`,
 * unlike almost everything else in the catalogue. Deleting an article that has
 * ever been priced is refused at the database, because the price row is the
 * record of what was charged and a cascade would erase the evidence along with
 * the article. (The catalogue's own answer to withdrawal is `retire`, which
 * leaves every row standing.)
 *
 * Isolation strategy: **`org-rls` with a real PostgreSQL policy** — see
 * migration 000804. This is the negotiated-price table; one kitchen reading
 * another's is the worst commercial failure this schema can have, and an
 * application scope is not a defence against a query somebody forgets to
 * scope.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('price_list_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('price_list_id')->constrained('price_lists')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->restrictOnDelete();
            $table->foreignUuid('catalogue_item_variant_id')->nullable()->constrained('catalogue_item_variants')->restrictOnDelete();
            $table->decimal('min_quantity', 12, 4)->nullable()->comment('tier threshold; NULL is the base price');
            $table->bigInteger('unit_amount_minor')->nullable()->comment('minor units of the LIST currency; NULL unless price_status is confirmed');
            $table->string('price_status', 20)->comment('confirmed | placeholder | market_priced — placeholder and market rows are never public');
            $table->date('effective_from')->comment('inclusive');
            $table->date('effective_to')->nullable()->comment('EXCLUSIVE; NULL means this is the standing row');
            // Declared as a plain column here and constrained below: a
            // self-referencing foreign key cannot be added in the same
            // statement batch that establishes the primary key it points at.
            $table->uuid('superseded_by_id')->nullable()->comment('the row that replaced this one; NULL on the standing row and on a withdrawn point');

            $table->string('source_system', 40)->nullable();
            $table->string('source_ref', 160)->nullable();
            $table->timestamp('seeded_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['price_list_id', 'catalogue_item_id', 'effective_from']);
        });

        Schema::table('price_list_items', function (Blueprint $table): void {
            $table->foreign('superseded_by_id')->references('id')->on('price_list_items')->nullOnDelete();
        });

        // The honest-badge invariant, in the only place that can guarantee it.
        DB::statement("ALTER TABLE price_list_items ADD CONSTRAINT price_list_items_price_status_check CHECK (price_status IN ('confirmed', 'placeholder', 'market_priced'))");
        DB::statement("ALTER TABLE price_list_items ADD CONSTRAINT price_list_items_confirmed_amount_check CHECK ((price_status = 'confirmed') = (unit_amount_minor IS NOT NULL))");
        DB::statement('ALTER TABLE price_list_items ADD CONSTRAINT price_list_items_effective_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from)');

        // One standing row per pricing point. Partial, so history is
        // unconstrained — a point may have been priced any number of times —
        // and NULLS NOT DISTINCT, so the variant-less and tier-less shapes
        // cannot each be opened twice.
        DB::statement('CREATE UNIQUE INDEX price_list_items_one_open_row_per_point ON price_list_items (price_list_id, catalogue_item_id, catalogue_item_variant_id, min_quantity) NULLS NOT DISTINCT WHERE effective_to IS NULL');

        DB::statement('CREATE UNIQUE INDEX price_list_items_organisation_id_source_unique ON price_list_items (organisation_id, source_system, source_ref) WHERE source_system IS NOT NULL AND source_ref IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('price_list_items');
    }
};
