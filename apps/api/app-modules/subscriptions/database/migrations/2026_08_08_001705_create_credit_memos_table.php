<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What the kitchen owes a customer whose subscription was cancelled with days
 * left on it.
 *
 * **No money moves here, and the schema says so.** The approved semantics (§3)
 * record a cancellation refund as a credit memo for *manual* settlement until
 * PAY1 exists, and this table is deliberately built so that it cannot pretend
 * otherwise: two statuses (`recorded`, `settled`), no payment method, no
 * provider, no transaction reference, no card anything. `settled_at` and
 * `settled_by` record that a human said the money changed hands — which is the
 * whole truth the platform has. The C1 architecture test's argument applies
 * unchanged: the first thing to write a payment reference into a schema with no
 * PCI scope creates a liability no later migration removes.
 *
 * **The amount is derived once and stored.** `unused_days ×
 * effective_day_price_minor` — the per-day price actually paid, *after* the
 * duration discount (§3), so the discount already enjoyed on delivered days is
 * not clawed back. All three numbers are kept rather than only the product,
 * because a customer disputing a refund is disputing one of the three and a
 * single total cannot say which.
 *
 * `subscription_id` is `cascadeOnDelete` and that is a considered choice rather
 * than the default: a memo is meaningless without the arrangement it refunds,
 * and a subscription only disappears when its customer account does — at which
 * point an unsettled memo naming a person who has been erased is a worse
 * artefact than no memo.
 *
 * Isolation strategy: `join-rls-parent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('credit_memos', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('organisation_id')->comment('the kitchen that owes it')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('customer_account_id')->constrained('customer_accounts')->cascadeOnDelete();
            $table->foreignUuid('subscription_id')->constrained('subscriptions')->cascadeOnDelete();

            $table->string('reason', 40)->default('subscription_cancelled')->comment('why it is owed — a vocabulary word');
            $table->integer('unused_days');
            $table->bigInteger('per_day_minor')->comment('the effective per-day price actually paid, after the duration discount');
            $table->bigInteger('amount_minor')->comment('unused_days x per_day_minor, stored so a dispute can be traced to one of three numbers');
            $table->string('currency_code', 3);

            $table->string('status', 12)->default('recorded')->comment('recorded | settled — the platform moves no money');
            $table->timestamp('recorded_at');
            $table->timestamp('settled_at')->nullable();
            $table->foreignUuid('settled_by')->nullable()->comment('the human who says it was paid')->constrained('users')->nullOnDelete();
            $table->string('settlement_note', 200)->nullable();

            $table->timestamps();

            $table->index(['organisation_id', 'status']);
            $table->index(['customer_account_id', 'status']);

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE credit_memos ADD CONSTRAINT credit_memos_status_check CHECK (status IN ('recorded', 'settled'))");
        DB::statement("ALTER TABLE credit_memos ADD CONSTRAINT credit_memos_reason_check CHECK (reason IN ('subscription_cancelled'))");
        DB::statement('ALTER TABLE credit_memos ADD CONSTRAINT credit_memos_amounts_check CHECK (unused_days > 0 AND per_day_minor >= 0 AND amount_minor >= 0)');
        DB::statement("ALTER TABLE credit_memos ADD CONSTRAINT credit_memos_settlement_check CHECK ((status = 'settled') = (settled_at IS NOT NULL))");

        // One memo per subscription. A second cancellation of the same
        // arrangement is impossible — `cancelled` is terminal — so a second
        // memo would be a double refund, and the index is what makes that a
        // failure rather than a discovery three months later.
        DB::statement('CREATE UNIQUE INDEX credit_memos_one_per_subscription ON credit_memos (subscription_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_memos');
    }
};
