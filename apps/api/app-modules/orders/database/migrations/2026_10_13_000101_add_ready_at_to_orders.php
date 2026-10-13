<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When the kitchen finished cooking an order — "Ready" on the kitchen display.
 *
 * Owner decision, 13 Oct 2026: Ready and Handed over are separate steps. Ready
 * used to fulfil the order outright, so a collection order nobody had picked up
 * read Fulfilled. Ready now stamps this column and leaves the order `confirmed`;
 * handing it over is the existing fulfil, which stamps `fulfilled_at`.
 *
 * A timestamp beside the status rather than a fifth status: being ready changes
 * nothing the status machine guards (a ready order can still be fulfilled or
 * cancelled exactly as a confirmed one can), so it is a fact about the order,
 * not a state of it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->timestamp('ready_at')->nullable()->after('confirmed_at');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropColumn('ready_at');
        });
    }
};
