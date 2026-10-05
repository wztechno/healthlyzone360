<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Owner ruling 2026-10-05: seventeen rows of the v6 Meals sheet — nuggets, mozzarella sticks,
 * popcorn chicken, cheese balls, crispy chicken, fajita, strips, kebbe, zinger, sambousek, rkakat,
 * makanek, marinated wings, cordon bleu, breaded fish and shrimps — are made ahead and sold from
 * the freezer. They become `frozen_meal` items published under the platform `frozen` category.
 *
 * `CatalogueItemService` refuses a type change through the API ("create the new one and retire
 * this") because a meal and a frozen meal sell differently. These rows already have what a frozen
 * meal needs — pack variants and the finished-goods ingredient its shelf is keyed by — and nothing
 * has been ordered against them as meals, so they move in place and keep their ids, recipe links,
 * channels and photographs.
 *
 * The refs are read from `v6-catalogue.json`, where the converter applies the same ruling, so a
 * fresh import and an upgraded database agree. A fresh database has no rows yet and this is a
 * no-op. Only rows still typed `meal` move, so it is safe to re-run.
 */
return new class extends Migration
{
    private const string SOURCE_SYSTEM = 'healthy360_workbook_v6';

    public function up(): void
    {
        $document = json_decode(
            (string) file_get_contents(dirname(__DIR__).'/data/v6-catalogue.json'),
            true,
            flags: JSON_THROW_ON_ERROR,
        );

        $refs = array_values(array_map(
            static fn (array $item): string => (string) $item['source_ref'],
            array_filter($document['items'], static fn (array $item): bool => $item['sheet_item_type'] === 'frozen_meal'),
        ));

        $frozenCategoryId = DB::table('product_categories')
            ->whereNull('organisation_id')
            ->where('code', 'frozen')
            ->value('id');

        DB::table('catalogue_items')
            ->where('source_system', self::SOURCE_SYSTEM)
            ->whereIn('source_ref', $refs)
            ->where('item_type', 'meal')
            ->update([
                'item_type' => 'frozen_meal',
                'product_category_id' => $frozenCategoryId ?? DB::raw('product_category_id'),
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        // Deliberately one-way: once these sell from the freezer, turning them back into meals
        // would make a sale explode the recipe a second time.
    }
};
