<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which items are offered through which channel, and when.
 *
 * A row here says "the web shop offers this, from this date, until that one".
 * Its absence says nothing at all — availability is not the same question as
 * publication, and an item can be published (a real, complete, sellable
 * article) while no channel offers it yet.
 *
 * `catalogue_item_variant_id` is nullable and the unique key is **NULLS NOT
 * DISTINCT**, so "the item, on this channel" and "this pack of the item, on
 * this channel" are two rows that cannot each be written twice. Without it,
 * PostgreSQL would treat every item-level row as distinct from every other,
 * and a channel could accumulate duplicates of the same statement.
 *
 * `available_from` / `available_to` are dates, not timestamps. A kitchen
 * decides "from Monday", not "from 00:00:00+04 on Monday"; storing the
 * precision nobody supplied would only invite a timezone bug at the boundary.
 * Both nullable: no start means "as soon as it is published", no end means
 * "indefinitely", and a CHECK refuses a window that ends before it begins.
 *
 * There is deliberately **no price column**. A channel assignment says what is
 * offered; what it costs is a `price_list_items` row in K1.5, effective-dated
 * separately, because a price changes far more often than an offering does
 * and merging them would make every repricing an edit to an availability
 * record.
 *
 * Isolation strategy: `join-rls-parent` — reachable through the channel and
 * the item, both of which are organisation-owned, with `organisation_id`
 * denormalised.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('channel_catalogue_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_variant_id')->nullable()->constrained('catalogue_item_variants')->cascadeOnDelete();
            $table->boolean('is_available')->default(true);
            $table->date('available_from')->nullable();
            $table->date('available_to')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['catalogue_item_id', 'is_available']);
        });

        DB::statement('ALTER TABLE channel_catalogue_items ADD CONSTRAINT channel_catalogue_items_unique UNIQUE NULLS NOT DISTINCT (sales_channel_id, catalogue_item_id, catalogue_item_variant_id)');
        DB::statement('ALTER TABLE channel_catalogue_items ADD CONSTRAINT channel_catalogue_items_window_check CHECK (available_from IS NULL OR available_to IS NULL OR available_to >= available_from)');
    }

    public function down(): void
    {
        Schema::dropIfExists('channel_catalogue_items');
    }
};
