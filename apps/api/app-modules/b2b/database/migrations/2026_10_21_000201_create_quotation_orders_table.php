<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Every order an accepted quotation placed (2026-10-21).
 *
 * A quotation the buyer marked "this should repeat" places one order a week
 * for the number of weeks they chose when accepting — same weekday, address
 * and window, each at the quoted prices. `quotations.order_id` keeps naming
 * the first; this is the whole run, one row per delivery, in order.
 *
 * Tenanted like `quotation_lines`: the buyer's organisation, denormalised.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quotation_orders', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->comment('the buyer, denormalised from the quotation')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('quotation_id')->constrained('quotations')->cascadeOnDelete();
            $table->foreignUuid('order_id')->constrained('orders')->cascadeOnDelete();
            $table->integer('sequence')->comment('1 for the first delivery, 2 for the next week, …');
            $table->date('delivery_date');
            $table->timestamps();

            $table->unique(['quotation_id', 'sequence']);
            $table->unique('order_id');
        });

        DB::statement('ALTER TABLE quotation_orders ADD CONSTRAINT quotation_orders_sequence_check CHECK (sequence > 0)');

        // The orders accepted before this table existed, as the run of one they were.
        DB::statement(<<<'SQL'
            INSERT INTO quotation_orders (id, organisation_id, quotation_id, order_id, sequence, delivery_date, created_at, updated_at)
            SELECT gen_random_uuid(), q.organisation_id, q.id, q.order_id, 1, COALESCE(o.requested_delivery_date, o.placed_at::date), now(), now()
            FROM quotations q JOIN orders o ON o.id = q.order_id
            WHERE q.order_id IS NOT NULL
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('quotation_orders');
    }
};
