<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * How many meals and snacks a day the subscriber bought, captured at purchase.
 *
 * The same grandfathering the per-day price already has (§5), for the food.
 * Generation cuts each day of a fixed menu to the subscriber's count, and that
 * count used to be read off the configuration as it stands today — so a kitchen
 * that edited an option from four meals to three cut every live subscriber to
 * three while they kept paying for four. A subscription now keeps the count it
 * was sold; an edited option reaches new subscriptions only.
 *
 * **Back-filled from the configuration as it stands at migration time**, which
 * is the best record there is of what each live subscriber bought. A
 * subscription whose configuration has no profile row stays NULL, and NULL
 * means what it meant before: read the configuration as it stands, and serve
 * the whole menu day when there is none.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('subscriptions', function (Blueprint $table): void {
            $table->smallInteger('captured_meals_per_day')->nullable()->after('captured_at')
                ->comment('Meals a day as sold; NULL = read the configuration');
            $table->smallInteger('captured_snacks_per_day')->nullable()->after('captured_meals_per_day')
                ->comment('Snacks a day as sold; NULL = read the configuration');
        });

        DB::statement(<<<'SQL'
            UPDATE subscriptions
               SET captured_meals_per_day = plan_variant_profiles.meals_per_day,
                   captured_snacks_per_day = plan_variant_profiles.snacks_per_day
              FROM plan_variant_profiles
             WHERE plan_variant_profiles.catalogue_item_variant_id = subscriptions.catalogue_item_variant_id
            SQL);
    }

    public function down(): void
    {
        Schema::table('subscriptions', function (Blueprint $table): void {
            $table->dropColumn(['captured_meals_per_day', 'captured_snacks_per_day']);
        });
    }
};
