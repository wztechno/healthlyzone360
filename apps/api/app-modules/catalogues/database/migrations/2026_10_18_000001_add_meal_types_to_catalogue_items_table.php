<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When in the day a meal is eaten — breakfast, lunch, dinner, snack (HA-35).
 *
 * The admin's Selling step drew these as chips and the marketplace named
 * `meal_types` among its filters, but nothing on `catalogue_items` recorded
 * them: every tick vanished on save. A JSON list of the four platform codes
 * (`MEAL_TYPES` in `@healthy360/domain-types`), validated by the item's
 * request rules.
 *
 * NOT NULL with `[]` as the default, so every existing row reads as "no meal
 * type stated" and no reader has to coalesce a null.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->jsonb('meal_types')->default('[]')
                ->comment('Platform meal-type codes: breakfast, lunch, dinner, snack.');
        });
    }

    public function down(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->dropColumn('meal_types');
        });
    }
};
