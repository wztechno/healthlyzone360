<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Packaging comes back into the ingredient catalogue.
 *
 * The exact reverse of `packaging/…_remove_packaging_from_ingredients.php`, and it undoes the
 * table split that migration was part of. One table again, with the two families told apart by
 * the taxonomy: packaging sits under `packaging-disposables`, the ingredient list excludes that
 * branch, the packaging list asks for it by name.
 *
 * ## Why the split is being undone rather than finished
 *
 * The separation's stated reason was that "remember to exclude a category" is a rule that holds
 * until the next query somebody writes. That is a fair worry, and it is not what actually went
 * wrong. What went wrong was narrower and fixable: the packaging page asked the *ingredient*
 * endpoint for a category, the code stopped resolving, and the filter **silently degraded to no
 * filter** — so the page rendered three hundred ingredients instead of no packaging. Both halves
 * of that are now closed in the client, which refuses an unresolvable code rather than dropping
 * the constraint.
 *
 * The mechanism the split abandoned was never removed: `IngredientIndexController` still takes
 * `exclude_category`, and `PACKAGING_CATEGORY_CODE` is still on the contract with a docblock
 * describing this arrangement. The callers went away; the design did not.
 *
 * ## Every row survives, and that is the whole difficulty
 *
 * The obvious implementation — drop the table and let `IngredientMasterSeeder` re-create the
 * rows from the seed document — loses data, quietly:
 *
 * - the seed document carries the **31 platform rows only**, so the two packaging items a
 *   kitchen typed by hand (`Bottle 300`, `Cap`) would simply cease to exist;
 * - it carries no prices and no capacities, and every one of the 33 rows is priced while ten
 *   hold a capacity.
 *
 * So this moves the rows instead, **preserving their ids** — which is also what makes the
 * `recipe_version_packaging` repoint below a rename rather than a repoint.
 *
 * ## Three columns arrive with them
 *
 * `waste_percent`, `capacity_quantity` and `capacity_unit_id` have no ingredient counterpart and
 * are added here, nullable, left null on food. `purchase_price_amount`/`_currency` join them, but
 * only where they are absent: some databases already carry that pair from a migration that was
 * deleted with the packaging module, so a developer's machine has it and a fresh one does not.
 *
 * `waste_percent` keeps the distinction the packaging table drew: NULL is "nobody has measured
 * this", `0` is "measured, and there is none". It is not folded into `yield_factor` — a yield is
 * what a roll-up multiplies by, and nothing rolls up a bin liner.
 *
 * ## Guarded so a fresh database is not a special case
 *
 * Every step checks for the table it reads. On an existing environment the tables are there and
 * the rows move; on a fresh one the packaging module's migrations are gone with the module, the
 * tables never existed, and this reduces to "add three columns" — the rows then arrive from the
 * seed document, which carries the `PKG-` rows again. Both paths end in the same place.
 */
return new class extends Migration
{
    /**
     * Values `ingredients` requires and packaging never had.
     *
     * `verification_status` is the interesting one. It is how this system spells an allergen
     * determination, and `verified` means "somebody assessed this and it carries nothing" — which
     * is the honest reading for a bin liner and, not incidentally, keeps packaging out of every
     * "undetermined allergen" report the publish gate and the determinations command produce.
     * `unverified` would put thirty-three boxes in front of a food-safety reviewer for no reason.
     */
    private const FOOD_DEFAULTS = [
        'yield_factor' => 1,
        'verification_status' => 'verified',
        'is_sellable' => false,
    ];

    public function up(): void
    {
        $this->addPackagingColumns();

        if (Schema::hasTable('packaging_categories')) {
            $this->moveCategories();
        }

        if (Schema::hasTable('packaging_items')) {
            $this->moveItems();
        }

        $this->repointRecipePackaging();

        Schema::dropIfExists('packaging_items');
        Schema::dropIfExists('packaging_categories');
    }

    public function down(): void
    {
        /*
         * Deliberately one-way for the data.
         *
         * Re-creating the two tables is easy; deciding which of the merged rows belonged to each
         * is not, once a kitchen has filed its own ingredient under a packaging category or moved
         * a packaging row out of one. The three columns are dropped, which is the reversible half,
         * and the rows stay where a person can see them.
         */
        Schema::table('recipe_version_packaging', function (Blueprint $table): void {
            if (Schema::hasColumn('recipe_version_packaging', 'ingredient_id')) {
                $table->dropForeign(['ingredient_id']);
                $table->renameColumn('ingredient_id', 'packaging_item_id');
            }
        });

        Schema::table('ingredients', function (Blueprint $table): void {
            $table->dropForeign(['capacity_unit_id']);
            $table->dropColumn(['waste_percent', 'capacity_quantity', 'capacity_unit_id']);
        });

        /*
         * `purchase_price_amount` is deliberately left in place.
         *
         * This migration adds it only where it was missing, and cannot tell that case from the
         * environments that already had it — dropping it on the way down would take a column, and
         * whatever a kitchen has recorded in it, off a database that never got it from here.
         */
    }

    private function addPackagingColumns(): void
    {
        /*
         * The pack price, where it is not already there.
         *
         * `purchase_price_amount` is the one column of the four that some databases already carry
         * and no migration in this repository creates — it arrived through a migration that was
         * deleted along with the packaging module, so a developer's machine has it and a fresh
         * one does not. Guarded rather than assumed: without this the insert below writes to a
         * column that exists on exactly the environments nobody tests on.
         *
         * Per *purchase pack*, not per issued unit — a sleeve at 6.50, never a bag at 0.065. The
         * `unit_price_amount` column beside it is the other denominator, and confusing the two
         * scales a cost by `items_per_unit`.
         */
        if (! Schema::hasColumn('ingredients', 'purchase_price_amount')) {
            Schema::table('ingredients', function (Blueprint $table): void {
                $table->decimal('purchase_price_amount', 18, 6)->nullable()
                    ->comment('CONFIDENTIAL — what one purchase pack costs, major units');
                $table->char('purchase_price_currency', 3)->nullable()
                    ->comment('ISO 4217, required whenever purchase_price_amount is set');
            });

            DB::statement(
                'ALTER TABLE ingredients ADD CONSTRAINT ingredients_purchase_price_currency_check '.
                'CHECK (purchase_price_amount IS NULL OR purchase_price_currency IS NOT NULL)'
            );
            DB::statement(
                'ALTER TABLE ingredients ADD CONSTRAINT ingredients_purchase_price_amount_check '.
                'CHECK (purchase_price_amount IS NULL OR purchase_price_amount >= 0)'
            );
        }

        Schema::table('ingredients', function (Blueprint $table): void {
            $table->decimal('waste_percent', 5, 2)->nullable()
                ->comment('Proportion discarded, as a percentage. NULL is unmeasured; 0 is measured and none.');
            $table->decimal('capacity_quantity', 12, 4)->nullable()
                ->comment('How much product one item holds, in the recipe\'s own unit — a 300 cc bottle carries 0.3 kg.');
            $table->foreignUuid('capacity_unit_id')->nullable()
                ->comment('The unit capacity_quantity is counted in.')
                ->constrained('measurement_units')->nullOnDelete();
        });

        // Both halves or neither: a capacity with no unit is a number nobody can use, and a unit
        // with no quantity is a column that says nothing.
        DB::statement(
            'ALTER TABLE ingredients ADD CONSTRAINT ingredients_capacity_pair_check '.
            'CHECK ((capacity_quantity IS NULL) = (capacity_unit_id IS NULL))'
        );
    }

    /**
     * The six `packaging-disposables*` nodes, back into the ingredient taxonomy.
     *
     * Ids and codes are preserved, so every row's category pointer survives the move untouched.
     * Parents before children, because the table's `parent_id` references itself.
     */
    private function moveCategories(): void
    {
        foreach ([true, false] as $topLevel) {
            $rows = DB::table('packaging_categories')
                ->when($topLevel, fn ($query) => $query->whereNull('parent_id'))
                ->when(! $topLevel, fn ($query) => $query->whereNotNull('parent_id'))
                ->orderBy('display_order')
                ->get();

            foreach ($rows as $row) {
                // Idempotent: a code the ingredient taxonomy already carries is left alone rather
                // than duplicated, so a re-run converges instead of failing on the unique index.
                $exists = DB::table('ingredient_categories')
                    ->where('code', $row->code)
                    ->where(fn ($query) => $row->organisation_id === null
                        ? $query->whereNull('organisation_id')
                        : $query->where('organisation_id', $row->organisation_id))
                    ->exists();

                if ($exists) {
                    continue;
                }

                DB::table('ingredient_categories')->insert([
                    'id' => $row->id,
                    'organisation_id' => $row->organisation_id,
                    'parent_id' => $row->parent_id,
                    'code' => $row->code,
                    'name_en' => $row->name_en,
                    'name_ar' => $row->name_ar,
                    'display_order' => $row->display_order,
                    'is_active' => $row->is_active,
                    'created_by' => $row->created_by,
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ]);
            }
        }
    }

    /**
     * The rows themselves, ids intact.
     *
     * Chunked rather than one statement so the column mapping is written once, in PHP, where it
     * can be read — this runs against at most a few dozen rows and buys nothing by being clever.
     */
    private function moveItems(): void
    {
        /*
         * The branch that *is* the discriminator, from here on.
         *
         * A row's membership of `packaging_items` used to be what made it packaging; the table is
         * going away, so the category has to carry that fact instead. Two of the thirty-three rows
         * — the ones a kitchen typed by hand — carry no category at all, which was harmless while
         * the table answered the question and would silently file them among the food the moment
         * it stopped. They are filed at the top level here.
         *
         * Not a guess: every row in this table is packaging by construction. Inferring it from
         * anything softer — a name, a unit — is how the wrong two rows end up in the wrong list.
         */
        $packagingRoot = DB::table('ingredient_categories')
            ->whereNull('organisation_id')
            ->where('code', 'packaging-disposables')
            ->value('id');

        DB::table('packaging_items')->orderBy('id')->chunk(200, function ($rows) use ($packagingRoot): void {
            $insert = [];

            foreach ($rows as $row) {
                $insert[] = self::FOOD_DEFAULTS + [
                    'id' => $row->id,
                    'organisation_id' => $row->organisation_id,
                    'slug' => $row->slug,
                    'name_en' => $row->name_en,
                    'name_ar' => $row->name_ar,
                    'ingredient_category_id' => $row->packaging_category_id ?? $packagingRoot,
                    'ingredient_subcategory_id' => $row->packaging_subcategory_id,
                    'kind' => $row->kind,
                    'composition' => $row->composition,
                    'default_unit_id' => $row->default_unit_id,
                    'purchase_unit_id' => $row->purchase_unit_id,
                    'items_per_unit' => $row->items_per_unit,
                    'waste_percent' => $row->waste_percent,
                    'purchase_price_amount' => $row->purchase_price_amount,
                    'purchase_price_currency' => $row->purchase_price_currency,
                    'capacity_quantity' => $row->capacity_quantity,
                    'capacity_unit_id' => $row->capacity_unit_id,
                    'forked_from_ingredient_id' => $row->forked_from_packaging_item_id,
                    'status' => $row->status,
                    'notes' => $row->notes,
                    'source_system' => $row->source_system,
                    'source_ref' => $row->source_ref,
                    'seeded_at' => $row->seeded_at,
                    'created_by' => $row->created_by,
                    'updated_by' => $row->updated_by,
                    'lock_version' => $row->lock_version,
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ];
            }

            if ($insert !== []) {
                // Ids are preserved, so a re-run would collide rather than duplicate. Skipping the
                // ones already moved is what makes this migration safe to retry after a failure
                // part-way through the chunk loop.
                DB::table('ingredients')->insertOrIgnore($insert);
            }
        });
    }

    /**
     * A recipe's packaging lines now name an ingredient.
     *
     * The column is renamed rather than added-and-backfilled because the ids did not change: the
     * value in `packaging_item_id` is already a valid `ingredients.id` by the time this runs. The
     * table is empty in every known environment, so this is DDL either way.
     *
     * **The old foreign key has to go first.** It points at `packaging_items`, and a table cannot
     * be dropped while something references it — PostgreSQL refuses with `2BP01` rather than
     * cascading, which is the right answer and is why this is ordered before the drops above.
     */
    private function repointRecipePackaging(): void
    {
        if (! Schema::hasTable('recipe_version_packaging')) {
            return;
        }

        if (! Schema::hasColumn('recipe_version_packaging', 'packaging_item_id')) {
            return;
        }

        DB::statement(
            'ALTER TABLE recipe_version_packaging '.
            'DROP CONSTRAINT IF EXISTS recipe_version_packaging_packaging_item_id_foreign'
        );

        Schema::table('recipe_version_packaging', function (Blueprint $table): void {
            $table->renameColumn('packaging_item_id', 'ingredient_id');
        });

        Schema::table('recipe_version_packaging', function (Blueprint $table): void {
            $table->foreign('ingredient_id')->references('id')->on('ingredients')->restrictOnDelete();
        });
    }
};
