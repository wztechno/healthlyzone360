<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Stock a confirmed production order has claimed but not yet taken (PROD1).
 *
 * `stock_levels.quantity` has been the only number on a shelf, and it answers
 * "what is here" — which is the wrong question once a batch has been committed
 * to. A kitchen that confirms twenty litres of dressing for Thursday still has
 * the oil on the shelf on Wednesday, and a customer order that eats it leaves
 * Thursday's batch short with nothing having gone wrong anywhere a reader could
 * see.
 *
 * So availability becomes on-hand minus what is claimed, and this table is what
 * is claimed.
 *
 * ## A table rather than a column
 *
 * `stock_levels.reserved_quantity` would have been one integer and no evidence.
 * A reservation that leaks — an order abandoned mid-flight, a release that did
 * not run — is then a number nobody can attribute, and the only repair is to
 * type over it. Rows name their holder, so a stuck claim can be traced to the
 * order that made it and released deliberately.
 *
 * ## Not a movement
 *
 * `stock_movements` is an append-only ledger of stock that actually moved, and
 * a reservation is precisely stock that has **not** moved. Putting one there
 * would make every quantity read off the ledger wrong, and the ledger is what
 * COGS and the monthly report are computed from.
 *
 * ## The partial unique index is the double-book guard
 *
 * One open row per holder per shelf. A confirm that ran twice — a retry, a
 * redelivered event — cannot claim the same oil under the same order a second
 * time, which is the concurrency failure a `reserved_quantity` column would have
 * had no defence against.
 *
 * `status` is three values rather than a deleted row, because *why* a claim
 * ended matters: `consumed` means the batch took it, `released` means the batch
 * never did. A production manager reading a cancelled order needs to see the
 * second and not infer it from an absence.
 *
 * Isolation strategy: `app-scope` — carries `organisation_id` and is read only
 * through services that scope on it explicitly, like `stock_levels` beside it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_reservations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();
            $table->foreignUuid('stock_item_id')->constrained('stock_items')->cascadeOnDelete();

            $table->decimal('quantity', 14, 4)->comment('in the stock item\'s own unit, like stock_levels.quantity');

            $table->string('holder_type', 32)->comment('what claimed it; `production_order` is the only holder today');
            $table->uuid('holder_id');

            $table->string('status', 16)->default('open');
            $table->timestamp('released_at')->nullable();

            $table->timestamps();

            // The availability sum: every open claim on one shelf at one branch.
            $table->index(['branch_id', 'stock_item_id', 'status']);

            // Reading one holder's claims — the order detail, and the release.
            $table->index(['holder_type', 'holder_id']);
        });

        DB::statement('ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_quantity_check CHECK (quantity > 0)');

        DB::statement("ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_status_check CHECK (status IN ('open', 'released', 'consumed'))");

        DB::statement("ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_released_check CHECK ((status = 'open') = (released_at IS NULL))");

        // One open claim per holder per shelf: a re-confirm cannot double-book.
        DB::statement("CREATE UNIQUE INDEX stock_reservations_open_holder ON stock_reservations (holder_type, holder_id, stock_item_id) WHERE status = 'open'");
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_reservations');
    }
};
