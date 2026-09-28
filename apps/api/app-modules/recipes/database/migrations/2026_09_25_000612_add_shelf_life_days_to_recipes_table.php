<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * How many days a batch of this recipe keeps (D-143).
 *
 * A batch's use-by date is its production date plus this, computed when the
 * batch is completed (`ProductionOrderService::batchDates()`). Zero is a real
 * answer — "use it the day it is made" — and null is "nobody has said", which
 * leaves the cook entering the date by hand as before.
 *
 * **On the recipe, not on a version — a deliberate departure** from the rule
 * `2026_08_02_000601` states, that everything which can change belongs to a
 * version. That rule protects the *formulation*: the lines, the yield, the
 * allergen label, which a customer's plate depends on and review exists to
 * check. Shelf life is none of those. It is how the kitchen keeps the food, an
 * operating parameter that gets corrected when a trial or an inspector says so,
 * and putting it on the version would force a new version through review to fix
 * a number no customer label carries. Published versions are frozen; this must
 * stay editable while one is live.
 *
 * Nothing already made moves with it. A completed batch stores the date it was
 * given in `production_orders.expiry_date`, so shortening a recipe's shelf life
 * never silently restates what is already on a shelf.
 *
 * The CHECK follows `suppliers.lead_time_days`: the one number on the row gets a
 * range. 3650 days is ten years — past any food, so a value above it is a
 * data-entry accident rather than a product.
 *
 * Every existing row starts NULL, which is today's behaviour exactly.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recipes', function (Blueprint $table): void {
            $table->unsignedSmallInteger('shelf_life_days')->nullable()
                ->comment('days a batch keeps; expiry = production date + this. On the recipe, not the version — see the migration docblock');
        });

        DB::statement('ALTER TABLE recipes ADD CONSTRAINT recipes_shelf_life_days_check CHECK (shelf_life_days IS NULL OR shelf_life_days BETWEEN 0 AND 3650)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_shelf_life_days_check');

        Schema::table('recipes', function (Blueprint $table): void {
            $table->dropColumn('shelf_life_days');
        });
    }
};
