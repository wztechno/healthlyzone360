<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A third reason a line's price is not the tariff's: the buyer accepted a
 * quotation and the order carries the kitchen's quoted unit price
 * (`PriceOverride::QUOTATION`).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS order_lines_price_source_check');
        DB::statement("ALTER TABLE order_lines ADD CONSTRAINT order_lines_price_source_check CHECK (price_source IS NULL OR price_source IN ('subscription_capture', 'subscription_included', 'quotation'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS order_lines_price_source_check');
        DB::statement("ALTER TABLE order_lines ADD CONSTRAINT order_lines_price_source_check CHECK (price_source IS NULL OR price_source IN ('subscription_capture', 'subscription_included'))");
    }
};
