<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When the driver collected the food — "Picked up" on the driver's run sheet.
 *
 * Owner decision, 16 Oct 2026 (HA-19): a delivery order is out for delivery when
 * the *driver* says they have it, not when the kitchen lets go of it. Until now
 * the kitchen display's "Handed over" fulfilled a delivery order, so the
 * customer read "Delivered" while the food was still on the counter. The
 * kitchen display no longer offers Handed over on a delivery order; the driver
 * presses Picked up, which stamps this column and moves the run to
 * `in_transit` / `en_route` — two values both CHECKs have always allowed and
 * nothing wrote until now. The order stays `confirmed` until the driver's
 * deliver fulfils it (BUG-10).
 *
 * A timestamp, not a new order status, for the reason `ready_at` gave: being
 * on the road changes nothing the order's status machine guards.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->timestamp('picked_up_at')->nullable()->after('assigned_at');
        });
    }

    public function down(): void
    {
        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->dropColumn('picked_up_at');
        });
    }
};
