<?php

declare(strict_types=1);

use Healthy360\Production\Enums\ProductionOrderStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `production_orders` becomes a batch a kitchen can actually run (PROD1).
 *
 * The table shipped as four columns and a status: branch, recipe version,
 * planned yield. It could record that somebody intended to cook something and
 * nothing else — not what the batch would need, not what it claimed, not what it
 * cost, not what came out, and not when it expires. This adds the rest.
 *
 * ## Two states are renamed, and the words are the change
 *
 * `planned → draft` and `in_progress → in_production`. The old pair described a
 * schedule; the new one describes a commitment. Nothing is reserved under
 * `draft`, which is what the word now says out loud, and `confirmed` — the state
 * that *does* claim stock — did not exist at all. `abandoned` joins them for the
 * distinction {@see ProductionOrderStatus} argues:
 * cancelled never carries stock movements, abandoned always may.
 *
 * Backfilled rather than assumed empty. There is no writer for this table in any
 * shipped surface, so the UPDATE should move nothing — which is exactly why it is
 * cheap to run and expensive to omit.
 *
 * ## Three figures are deliberately **not** columns
 *
 * `usable_yield_quantity` is `produced − rejected`, `yield_variance_quantity` is
 * `produced − planned_yield`, and whether a batch is late is a comparison against
 * today. All three are pure functions of columns that are here, and this codebase
 * has one answer to that: compute it. A stored copy is a second answer to a
 * question the row already answers, and it is wrong the first time anything but
 * its own writer touches the inputs.
 *
 * ## `batch_factor` rather than a second yield figure
 *
 * How many times over the recipe is being made — the number the explosion was
 * actually run at. It is *derivable* from `planned_yield ÷ version.yield_quantity`
 * only for as long as the version says what it said at confirm, and a published
 * version can be superseded. So the factor is stored and the derivation is not
 * repeated: a batch confirmed at 2.5× stays a batch of 2.5×.
 *
 * ## Money columns carry their currency, and the unit cost may be withheld
 *
 * `estimated_cost_amount` / `estimated_cost_currency_code` and their `actual_`
 * counterparts follow the house CHECK: an amount without a currency is not a
 * figure. `actual_unit_cost_amount` is **null unless `actual_cost_status` is
 * `complete`** — a partial total reads exactly like a complete one, which is the
 * failure `CostComputation::isComplete()` exists to prevent — and the CHECK on the
 * table enforces it rather than leaving it to a service to remember.
 *
 * Isolation strategy: `app-scope`, the `production_orders` row's existing
 * strategy, unchanged by this migration. No policy joins the RLS set.
 */
return new class extends Migration
{
    private const string STATUS_CONSTRAINT = 'production_orders_status_check';

    public function up(): void
    {
        // The old CHECK names four states this migration is about to violate, so
        // it goes first and the new one arrives after the backfill.
        DB::statement('ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS '.self::STATUS_CONSTRAINT);

        DB::statement("UPDATE production_orders SET status = 'draft' WHERE status = 'planned'");
        DB::statement("UPDATE production_orders SET status = 'in_production' WHERE status = 'in_progress'");

        Schema::table('production_orders', function (Blueprint $table): void {
            $table->string('reference', 16)->nullable()->comment('the kitchen-facing batch number, PB- plus eight Crockford base-32 characters');

            // What is being made. Null while a draft has not chosen its output —
            // and after confirm it is the version's single output, copied here so
            // the batch keeps naming what it made even if the version moves on.
            $table->foreignUuid('production_item_ingredient_id')->nullable()->constrained('ingredients')->nullOnDelete();

            $table->decimal('batch_factor', 14, 6)->nullable()->comment('how many times over the recipe is being made; what the explosion was run at');
            $table->foreignUuid('planned_yield_unit_id')->nullable()->constrained('measurement_units')->restrictOnDelete();

            $table->decimal('produced_quantity', 14, 4)->nullable()->comment('what came out, in the planned yield unit; includes anything later rejected');
            $table->decimal('rejected_quantity', 14, 4)->nullable()->comment('produced and then discarded — inside produced_quantity, never beside it');

            $table->date('production_date')->nullable()->comment('the branch-local business date the batch was made, like goods_receipts.received_on');
            $table->string('batch_reference', 64)->nullable()->comment('what the cook writes on the label; free text, not the system reference');
            $table->string('storage_location', 120)->nullable();
            $table->date('expiry_date')->nullable();

            $table->decimal('estimated_cost_amount', 18, 6)->nullable()->comment('the batch cost at confirm, from the weekly prices of that moment');
            $table->string('estimated_cost_currency_code', 3)->nullable();
            // Soft, deliberately: `weekly_price_publications` lives in Procurement,
            // and a foreign key here would put a schema-level edge from Production
            // to Procurement in order to protect a row that is append-only and
            // never deleted. The `order_consumption_exceptions` precedent — a
            // record that outlives what it names.
            $table->uuid('weekly_price_publication_id')->nullable()->comment('the price basis the estimate was computed against; what makes it reproducible. Soft reference to weekly_price_publications');

            $table->jsonb('nutrition_facts')->nullable()->comment("the version's facts, snapshotted at confirm so the batch sheet does not move when the recipe is edited");

            $table->decimal('actual_cost_amount', 18, 6)->nullable()->comment('(consumed input cost − input waste cost) at completion');
            $table->string('actual_cost_currency_code', 3)->nullable();
            $table->decimal('actual_unit_cost_amount', 18, 6)->nullable()->comment('actual_cost_amount ÷ produced_quantity; withheld unless actual_cost_status is complete');
            $table->string('actual_cost_status', 16)->nullable();
            $table->string('valuation_note', 255)->nullable()->comment('why the cost is partial or unvalued, in the words a reader needs');

            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('abandoned_at')->nullable();
            $table->string('abandon_reason', 255)->nullable();

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedInteger('lock_version')->default(0);
            $table->text('notes')->nullable();

            // The desk queue: this branch's open batches, newest first.
            $table->index(['organisation_id', 'branch_id', 'status']);
            // The batch register, and the expiry watch.
            $table->index(['organisation_id', 'production_date']);
            $table->index(['organisation_id', 'expiry_date']);
        });

        // One reference per kitchen. Partial, because a draft has none yet and
        // several nulls are not a collision.
        DB::statement('CREATE UNIQUE INDEX production_orders_reference_unique ON production_orders (organisation_id, reference) WHERE reference IS NOT NULL');

        DB::statement(
            'ALTER TABLE production_orders ADD CONSTRAINT '.self::STATUS_CONSTRAINT.
            " CHECK (status IN ('draft', 'confirmed', 'in_production', 'completed', 'cancelled', 'abandoned'))"
        );

        DB::statement(
            "ALTER TABLE production_orders ADD CONSTRAINT production_orders_cost_status_check CHECK (actual_cost_status IS NULL OR actual_cost_status IN ('complete', 'partial', 'unvalued'))"
        );

        // An amount without a currency is not a figure — the house rule, stated
        // per pair rather than once, because the two pairs are written at
        // different moments by different code paths.
        DB::statement(
            'ALTER TABLE production_orders ADD CONSTRAINT production_orders_estimated_currency_check CHECK ((estimated_cost_amount IS NULL) = (estimated_cost_currency_code IS NULL))'
        );

        DB::statement(
            'ALTER TABLE production_orders ADD CONSTRAINT production_orders_actual_currency_check CHECK ((actual_cost_amount IS NULL) = (actual_cost_currency_code IS NULL))'
        );

        // The withholding rule, in the schema rather than in a service's memory.
        DB::statement(
            "ALTER TABLE production_orders ADD CONSTRAINT production_orders_unit_cost_check CHECK (actual_unit_cost_amount IS NULL OR actual_cost_status = 'complete')"
        );

        DB::statement('ALTER TABLE production_orders ADD CONSTRAINT production_orders_quantities_check CHECK ((produced_quantity IS NULL OR produced_quantity >= 0) AND (rejected_quantity IS NULL OR rejected_quantity >= 0))');

        // Rejected units are part of what was produced, never an addition to it.
        DB::statement('ALTER TABLE production_orders ADD CONSTRAINT production_orders_rejected_within_produced_check CHECK (rejected_quantity IS NULL OR (produced_quantity IS NOT NULL AND rejected_quantity <= produced_quantity))');

        DB::statement('ALTER TABLE production_orders ADD CONSTRAINT production_orders_batch_factor_check CHECK (batch_factor IS NULL OR batch_factor > 0)');
    }

    public function down(): void
    {
        foreach ([
            'production_orders_batch_factor_check',
            'production_orders_rejected_within_produced_check',
            'production_orders_quantities_check',
            'production_orders_unit_cost_check',
            'production_orders_actual_currency_check',
            'production_orders_estimated_currency_check',
            'production_orders_cost_status_check',
        ] as $constraint) {
            DB::statement('ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS '.$constraint);
        }

        DB::statement('DROP INDEX IF EXISTS production_orders_reference_unique');
        DB::statement('ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS '.self::STATUS_CONSTRAINT);

        Schema::table('production_orders', function (Blueprint $table): void {
            $table->dropIndex(['organisation_id', 'expiry_date']);
            $table->dropIndex(['organisation_id', 'production_date']);
            $table->dropIndex(['organisation_id', 'branch_id', 'status']);

            $table->dropConstrainedForeignId('created_by');
            $table->dropConstrainedForeignId('planned_yield_unit_id');
            $table->dropConstrainedForeignId('production_item_ingredient_id');

            $table->dropColumn([
                'reference',
                'batch_factor',
                'produced_quantity',
                'rejected_quantity',
                'production_date',
                'batch_reference',
                'storage_location',
                'expiry_date',
                'estimated_cost_amount',
                'estimated_cost_currency_code',
                'weekly_price_publication_id',
                'nutrition_facts',
                'actual_cost_amount',
                'actual_cost_currency_code',
                'actual_unit_cost_amount',
                'actual_cost_status',
                'valuation_note',
                'confirmed_at',
                'started_at',
                'completed_at',
                'cancelled_at',
                'abandoned_at',
                'abandon_reason',
                'lock_version',
                'notes',
            ]);
        });

        DB::statement("UPDATE production_orders SET status = 'planned' WHERE status IN ('draft', 'confirmed')");
        DB::statement("UPDATE production_orders SET status = 'in_progress' WHERE status = 'in_production'");
        DB::statement("UPDATE production_orders SET status = 'cancelled' WHERE status = 'abandoned'");

        DB::statement(
            'ALTER TABLE production_orders ADD CONSTRAINT '.self::STATUS_CONSTRAINT.
            " CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled'))"
        );
    }
};
