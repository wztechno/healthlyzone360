<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which tariffs a channel prices from, and in what order it consults them.
 *
 * A channel may hold more than one list on purpose: a wholesale desk usually
 * has a standing trade tariff plus a negotiated sheet for one account, and the
 * negotiated sheet wins where it says anything. That is what `priority`
 * encodes — **lower number, consulted first** — and the resolver stops at the
 * first list that prices the point rather than merging them, so a client's
 * agreement can override two lines of a trade tariff without having to restate
 * the other four hundred.
 *
 * Priority is assigned from the submitted array order rather than typed by
 * hand: the order a merchandiser lists the tariffs in *is* the order they mean
 * them to be consulted in, and asking them to also invent non-colliding
 * integers is asking them to do the machine's arithmetic.
 *
 * `UNIQUE (sales_channel_id, price_list_id)` — one channel states its
 * relationship with one list once. Stating it twice at two priorities is not a
 * richer configuration, it is a contradiction.
 *
 * There is deliberately **no `is_active` flag**. An assignment either exists
 * or it does not; a switched-off assignment is a row that prices nothing while
 * looking as though it does, and the thing that genuinely goes quiet — the
 * channel — already has a status of its own.
 *
 * Isolation strategy: `join-rls-parent` — reachable only through a channel or
 * a list, cascade-deleted with either, with `organisation_id` denormalised so
 * a future policy can be evaluated without a join. It carries no amount: the
 * numbers are one join away in `price_list_items`, which holds the policy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('channel_price_lists', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->foreignUuid('price_list_id')->constrained('price_lists')->cascadeOnDelete();
            $table->integer('priority')->default(0)->comment('lower is consulted first');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['sales_channel_id', 'price_list_id']);
            $table->index(['sales_channel_id', 'priority']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('channel_price_lists');
    }
};
