<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Two new sellable kinds: `sauce` and `dressing`.
 *
 * The v6 catalogue separates them from meals — same apparatus (one table, one
 * price path, one publication gate), their own type so kitchen screens and
 * customer filters can treat them as their own lists. Storage-wise this is
 * exactly what the `item_type` discriminator exists for; only the CHECK
 * constraint needs to learn the words.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE catalogue_items DROP CONSTRAINT catalogue_items_item_type_check');
        DB::statement("ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_item_type_check CHECK (item_type IN ('product', 'meal', 'subscription_plan', 'sauce', 'dressing'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE catalogue_items DROP CONSTRAINT catalogue_items_item_type_check');
        DB::statement("ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_item_type_check CHECK (item_type IN ('product', 'meal', 'subscription_plan'))");
    }
};
