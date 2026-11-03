<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who moved the stock.
 *
 * `InventoryService::recordMovement()` is the one path that writes this ledger, so
 * it is the one place that stamps the signed-in person. A null is either a row from
 * before this column or a movement a job made with nobody signed in. Existing rows
 * stay exactly as they are: the ledger is append-only and has no back-fill.
 *
 * The foreign key names no delete action, because `nullOnDelete` would need the
 * `UPDATE` this ledger's runtime role has lost. The application never deletes a
 * user.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table): void {
            $table->foreignUuid('actor_user_id')->nullable()->comment('who moved it; null before this column, or a job with nobody signed in')->constrained('users');
            $table->index(['organisation_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table): void {
            $table->dropIndex(['organisation_id', 'created_at']);
            $table->dropConstrainedForeignId('actor_user_id');
        });
    }
};
