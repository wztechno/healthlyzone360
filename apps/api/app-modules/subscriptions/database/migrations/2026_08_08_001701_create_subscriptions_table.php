<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A standing arrangement to be fed: which plan, on which weekdays, at which
 * price, with how many delivery days left.
 *
 * **A balance, not a calendar range** (approved semantics §1). There is no
 * `starts_on`/`ends_on` pair here and that absence is the whole design: a
 * twenty-day plan is twenty *deliveries*, and skipping or pausing stretches it
 * into the future rather than burning it. `balance_days_total` and
 * `balance_days_consumed` are the two numbers that say where a subscription is,
 * and the second is a **cached count** of the `subscription_deliveries` rows
 * that consumed a day — the ledger is the truth, this column is the index. A
 * CHECK keeps it inside the total, because a balance that has gone negative is
 * a bug that must not be allowed to become an unbounded free subscription.
 *
 * **The price is captured here, once, and never re-resolved** (§5). Three
 * columns rather than one: `captured_unit_price_minor` is what the tariff said
 * per day, `captured_discount_percent` is what the duration took off it, and
 * `effective_day_price_minor` is the number the customer actually pays — the
 * grandfathered one, and the one a cancellation refund multiplies by the unused
 * days. Storing the derivation as well as the result is what lets somebody
 * answer "why is this customer paying 1 800 when the plan costs 2 000" two
 * years after both the tariff row and the discount have been superseded.
 * `captured_discount_percent` is nullable and NULL means *nobody stated one* —
 * the same rule `plan_variant_durations` makes, preserved across the capture
 * rather than coerced to zero on the way through.
 *
 * `captured_price_list_id` and `captured_price_list_item_id` carry **no foreign
 * key**, deliberately and for the same reason `order_lines` does not: a
 * standing price row is closed when superseded and a whole list can be removed,
 * and the capture has to outlive both.
 *
 * **`customer_address_id` is a foreign key and nothing is snapshotted here.**
 * The C1 pattern is FK on the standing record and a full snapshot on each
 * order, which is right: a customer who moves house wants the next delivery to
 * follow them, and the orders already placed must still say where they went.
 * `restrictOnDelete` because a live subscription pointing at a deleted address
 * would generate an order with nowhere to go; closing the subscription is the
 * way to release the address.
 *
 * `weekdays` is an ISO array (1 = Monday … 7 = Sunday) held as jsonb, the same
 * shape `delivery_windows.weekdays` uses. It is **not** allowed to be empty
 * here, and that is the difference: an empty window means "every day", but a
 * subscription with no delivery weekdays would generate nothing forever and
 * look like a platform fault rather than like the contradiction it is.
 *
 * `no_substitutions` is the §6 opt-out: "no substitutions — skip instead", per
 * subscription. It is a column and not a preference on the customer because two
 * arrangements can reasonably differ — a cautious parent's children's plan and
 * their own.
 *
 * `next_generation_date` is the scheduler's cursor: the next delivery date the
 * hourly tick should consider. Nullable because a paused or terminal
 * subscription has no next date, and an index on `(status,
 * next_generation_date)` is what keeps the sweep from reading every row in the
 * table every hour.
 *
 * Isolation strategy: **application scope, no PostgreSQL policy** — the C1
 * decision for `carts` and `orders`, taken here for the same reason. The owner
 * of a subscription is a customer, and a customer is not a member of the
 * kitchen they buy from; an organisation policy would hide every row from the
 * person who owns it. The eleven-table policy pin in `RlsTest` stays eleven.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscriptions', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('organisation_id')->comment('the SELLER — the kitchen whose plan this is')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('customer_account_id')->constrained('customer_accounts')->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->comment('the channel it was bought through; generation prices and offers against it')->constrained('sales_channels')->restrictOnDelete();
            $table->foreignUuid('branch_id')->nullable()->comment('the kitchen that produces it, when one is chosen')->constrained('organisation_branches')->nullOnDelete();

            $table->foreignUuid('catalogue_item_id')->comment('the plan')->constrained('catalogue_items')->restrictOnDelete();
            $table->foreignUuid('catalogue_item_variant_id')->comment('the plan configuration — the matrix cell')->constrained('catalogue_item_variants')->restrictOnDelete();
            $table->foreignUuid('plan_duration_id')->comment('the run bought')->constrained('plan_durations')->restrictOnDelete();

            $table->string('currency_code', 3)->comment('ISO 4217 — the captured price is denominated in it');
            $table->bigInteger('captured_unit_price_minor')->comment('what the tariff said per day at purchase, before the duration discount');
            $table->decimal('captured_discount_percent', 5, 2)->nullable()->comment('NULL means nobody stated one — never coerced to 0');
            $table->bigInteger('effective_day_price_minor')->comment('the GRANDFATHERED per-day price actually paid; a refund is unused days x this');
            $table->uuid('captured_price_list_id')->nullable()->comment('which tariff priced it; no FK, so the capture outlives the tariff');
            $table->uuid('captured_price_list_item_id')->nullable()->comment('which row said so; no FK, for the same reason');
            $table->timestamp('captured_at');

            $table->jsonb('weekdays')->comment('ISO weekdays, 1 = Monday … 7 = Sunday; never empty');
            $table->string('delivery_window_code', 40)->nullable()->comment("the slot's own code, as orders carry it");
            $table->foreignUuid('customer_address_id')->constrained('customer_addresses')->restrictOnDelete();

            $table->string('status', 12)->default('active')->comment('active | paused | cancelled | completed');
            $table->integer('balance_days_total');
            $table->integer('balance_days_consumed')->default(0)->comment('cached count of subscription_deliveries rows that consumed a day');
            $table->date('next_generation_date')->nullable()->comment("the scheduler's cursor: the next delivery date to consider");
            $table->boolean('no_substitutions')->default(false)->comment('the §6 opt-out — skip the slot rather than substitute');

            $table->timestamp('paused_at')->nullable();
            $table->timestamp('resumed_at')->nullable();
            $table->integer('pause_count')->default(0);

            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancellation_reason', 40)->nullable()->comment('a short vocabulary word, never free text a redactor would blank');
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('completed_at')->nullable();

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->index(['customer_account_id', 'status']);
            $table->index(['organisation_id', 'status']);
            $table->index(['status', 'next_generation_date'], 'subscriptions_generation_cursor');

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('active', 'paused', 'cancelled', 'completed'))");
        DB::statement('ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_balance_total_check CHECK (balance_days_total > 0)');
        DB::statement('ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_balance_consumed_check CHECK (balance_days_consumed >= 0 AND balance_days_consumed <= balance_days_total)');
        DB::statement('ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_prices_check CHECK (captured_unit_price_minor >= 0 AND effective_day_price_minor >= 0 AND effective_day_price_minor <= captured_unit_price_minor)');
        DB::statement('ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_discount_check CHECK (captured_discount_percent IS NULL OR (captured_discount_percent >= 0 AND captured_discount_percent < 100))');

        // A subscription with no delivery weekday would generate nothing for
        // ever, which is indistinguishable from a broken scheduler. Refused by
        // PostgreSQL rather than by the service, because an importer or a
        // backfill is exactly what would reintroduce it.
        DB::statement("ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_weekdays_check CHECK (jsonb_typeof(weekdays) = 'array' AND jsonb_array_length(weekdays) > 0)");

        // A terminal state carries its moment, and a live one does not carry
        // somebody else's. Stated as a constraint so a transition that forgot
        // to stamp its timestamp fails loudly instead of leaving a cancelled
        // subscription nobody can date.
        DB::statement("ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_terminal_stamp_check CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL) AND (status = 'completed') = (completed_at IS NOT NULL))");
    }

    public function down(): void
    {
        Schema::dropIfExists('subscriptions');
    }
};
