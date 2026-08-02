<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A route to market a kitchen sells through: its web shop, its wholesale
 * desk, the counter till, a marketplace listing, a corporate arrangement, an
 * insurer programme.
 *
 * **A row, not an enum.** The frontend contract carries a closed
 * `SalesChannel` union, and that is right for a *prototype* which has to
 * render something before any kitchen exists. It is wrong for the database:
 * two kitchens legitimately run two different wholesale desks with different
 * availability and — from K1.5 — different price lists, and a union value
 * cannot be owned by an organisation. So the *kind* is constrained and the
 * *channel* is a row: `channel_kind` is the closed vocabulary a projection
 * can branch on, `code` is the kitchen's own name for one instance of it.
 * The reconciliation is recorded in `docs/api/conventions.md`.
 *
 * `organisation_id` is NOT NULL. There is no platform channel library and
 * there should not be: a channel is a commercial arrangement, and a shared
 * one would mean two tenants writing availability rows against the same
 * parent.
 *
 * `order_source` is nullable free text rather than a second CHECK. It records
 * how an order that arrives through this channel labels itself in a partner's
 * system (`web`, `whatsapp`, `phone`, a marketplace's own token), which is
 * somebody else's vocabulary and not ours to constrain — the same argument
 * `recipes.recipe_category` makes.
 *
 * `status` is `active | inactive`, not the sellable family: a channel is
 * operational configuration, never published content. Nothing a customer sees
 * is a channel — what a customer sees is the items available *through* one.
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope in K1.4** — the
 * PostgreSQL policy set is unchanged by this slice (appendix D).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales_channels', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('code', 40);
            $table->string('channel_kind', 20)->comment('b2c_web | b2b | pos | marketplace | corporate | insurance');
            $table->string('name_en');
            $table->string('name_ar');
            $table->string('order_source', 30)->nullable()->comment("how orders arriving here label themselves in a partner's system — deliberately unconstrained");
            $table->string('status', 20)->default('active')->comment('active | inactive');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique(['organisation_id', 'code']);
            $table->index(['organisation_id', 'status']);
        });

        DB::statement("ALTER TABLE sales_channels ADD CONSTRAINT sales_channels_channel_kind_check CHECK (channel_kind IN ('b2c_web', 'b2b', 'pos', 'marketplace', 'corporate', 'insurance'))");
        DB::statement("ALTER TABLE sales_channels ADD CONSTRAINT sales_channels_status_check CHECK (status IN ('active', 'inactive'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('sales_channels');
    }
};
