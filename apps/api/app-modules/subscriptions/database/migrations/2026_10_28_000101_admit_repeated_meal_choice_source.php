<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Customers choose every meal now, and a day nobody chose for — a balance day a
 * skip or a pause pushed later — is filled by repeating the customer's own
 * latest choices for that weekday. Such a row is `repeated`: not a choice the
 * person made for this date, and not the kitchen's either.
 *
 * `kitchen_default` stays admitted for the rows the retired plan menu wrote.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE subscription_meal_choices DROP CONSTRAINT subscription_meal_choices_source_check');
        DB::statement("ALTER TABLE subscription_meal_choices ADD CONSTRAINT subscription_meal_choices_source_check CHECK (source IN ('customer', 'kitchen_default', 'substituted', 'repeated'))");
        DB::statement("COMMENT ON COLUMN subscription_meal_choices.source IS 'customer | kitchen_default | substituted | repeated'");
    }

    public function down(): void
    {
        DB::statement("DELETE FROM subscription_meal_choices WHERE source = 'repeated'");
        DB::statement('ALTER TABLE subscription_meal_choices DROP CONSTRAINT subscription_meal_choices_source_check');
        DB::statement("ALTER TABLE subscription_meal_choices ADD CONSTRAINT subscription_meal_choices_source_check CHECK (source IN ('customer', 'kitchen_default', 'substituted'))");
        DB::statement("COMMENT ON COLUMN subscription_meal_choices.source IS 'customer | kitchen_default | substituted'");
    }
};
