<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Why this line's price is not the price the tariff says today.
 *
 * **The one column S1 adds to a C1 table, and it exists because grandfathering
 * breaks an invariant C1 could previously assume.** `OrderPlacementService`
 * reprices every line at placement and that is still the rule; a subscription
 * delivery is the single exception the approved semantics create (§5 — "a live
 * subscription keeps the per-day price captured at purchase for its entire
 * balance"). Without this column, a reconciliation that compared an order line
 * against the standing price list would find a discrepancy and have nothing to
 * read that explains it, and the explanation would live only in a table
 * (`subscriptions`) that finance has no reason to join to.
 *
 * NULL means what it has always meant and what every existing row means: the
 * line was priced by the resolver at placement. The column is nullable with no
 * default precisely so that no back-fill is needed and no existing row acquires
 * a claim nobody made.
 *
 * **Two values, because a subscription order has two kinds of line.**
 * `subscription_capture` is the plan-day line, charged at the grandfathered
 * per-day price. `subscription_included` is a meal line at zero: the dishes
 * that make up the day, listed so the kitchen has a picking list and the
 * customer has a record of what they were sent, and priced at nothing because
 * the plan-day line has already charged for them. Without the second value a
 * zero-priced line would be indistinguishable from a mistake — and a
 * reconciliation that saw one would be right to raise it.
 *
 * The CHECK admits exactly those two. Widening it is a migration somebody
 * writes on purpose, which is the same posture `orders_payment_method_check`
 * takes — a free-text provenance column is one an importer eventually fills
 * with a sentence.
 *
 * `price_source` is not a cost column and does not trip the C1 architecture
 * test's denylist: it names *whose* price, never what the food cost the
 * kitchen.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_lines', function (Blueprint $table): void {
            $table->string('price_source', 30)->nullable()->after('price_list_item_id')
                ->comment('NULL = repriced at placement by the resolver; subscription_capture = the grandfathered per-day price (§5); subscription_included = a dish already paid for by that line');
        });

        DB::statement("ALTER TABLE order_lines ADD CONSTRAINT order_lines_price_source_check CHECK (price_source IS NULL OR price_source IN ('subscription_capture', 'subscription_included'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS order_lines_price_source_check');

        Schema::table('order_lines', function (Blueprint $table): void {
            $table->dropColumn('price_source');
        });
    }
};
