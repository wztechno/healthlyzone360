<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A fourth reason a line's price is not the tariff's: it replaces food the kitchen
 * got wrong, at no charge (`PriceOverride::REMAKE`).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS order_lines_price_source_check');
        DB::statement("ALTER TABLE order_lines ADD CONSTRAINT order_lines_price_source_check CHECK (price_source IS NULL OR price_source IN ('subscription_capture', 'subscription_included', 'quotation', 'remake'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS order_lines_price_source_check');
        DB::statement("ALTER TABLE order_lines ADD CONSTRAINT order_lines_price_source_check CHECK (price_source IS NULL OR price_source IN ('subscription_capture', 'subscription_included', 'quotation'))");
    }
};
