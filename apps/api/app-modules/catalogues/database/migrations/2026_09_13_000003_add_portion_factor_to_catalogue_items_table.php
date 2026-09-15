<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * How much of a recipe yield piece the sold article actually is.
 *
 * A recipe version states a yield: "this batch makes 12 pieces". A catalogue
 * item is what a customer buys, and the two are not always the same thing. A
 * kitchen that portions its lasagne tray into 12 squares and sells a *half*
 * square as the small size has one recipe, one piece count, and two articles
 * that differ only by this number. `1` is the overwhelmingly common answer —
 * one piece is one sold unit — and the interesting values are the halves and
 * doubles.
 *
 * ## One number, two readers, so they cannot drift
 *
 * The figure scales **both** sides of the same physical portion:
 *
 * - the customer's per-serving nutrition (the marketplace projection divides
 *   the version's per-recipe facts by the piece count, then multiplies by
 *   this), and
 * - the stock a sale consumes (the inventory module's meal explosion, whose
 *   per-sold-unit quantity is the same division times the same factor).
 *
 * That pairing is the whole reason it lives on the item as one column rather
 * than as a nutrition setting beside a separate consumption setting. A half
 * portion that told the diner 300 kcal while taking a full piece off the shelf
 * would be wrong in the two directions that matter most — a label claim and a
 * stock count — and nothing would ever reconcile the two. Sold portions are
 * declared once.
 *
 * ## Default 1, so every existing row keeps today's meaning
 *
 * Before this column existed, the code divided by the piece count and stopped.
 * `1` reproduces that exactly, so the backfill is the default and no existing
 * item's nutrition or deduction moves by a gram on the deploy that adds it.
 *
 * ## NOT NULL — a portion that is "unknown" is one, not nothing
 *
 * The nullable version of this column would mean "nobody has said", and every
 * reader would then have to coalesce it to 1 — which is to say, every reader
 * would answer "one piece" anyway, in its own copy of the rule. Sooner or
 * later one of them would coalesce to 0 instead, or propagate the null into a
 * withheld figure, and a meal would silently stop consuming stock. The
 * defaulted NOT NULL column says the same thing once, in the one place that
 * cannot be skipped. An explicit `null` on the wire is a 422, not a reset.
 *
 * ## CHECK > 0
 *
 * Zero is a sale that eats nothing and feeds nobody — a data-entry accident
 * every time, and a silent one: the explosion would produce no rows and the
 * order would look perfectly consumed. Negative is not a portion at all. The
 * request rules refuse anything below `0.001` so a value that would *round*
 * into zero at the column's three places is a named 422 rather than a 500 from
 * this constraint.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->decimal('portion_factor', 6, 3)->default('1')
                ->comment('The portion sold, as a multiple of one recipe yield piece; 1 = one piece is one sold unit');
        });

        DB::statement('ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_portion_factor_check CHECK (portion_factor > 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE catalogue_items DROP CONSTRAINT IF EXISTS catalogue_items_portion_factor_check');

        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->dropColumn('portion_factor');
        });
    }
};
