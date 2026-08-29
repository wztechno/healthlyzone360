<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Seeders;

use Healthy360\Catalogues\Models\ProductCategory;
use Illuminate\Database\Seeder;

/**
 * The platform product taxonomy — ten shelves, `organisation_id` NULL, visible
 * in every tenant context.
 *
 * These are the source catalogue's own merchandising groups, kept as it wrote
 * them rather than tidied into something more symmetrical: "toppings" and
 * "condiment" overlap, "oil" is arguably a condiment, and a kitchen that files
 * its tahini under one of them is telling us something a rationalised taxonomy
 * would erase. A tenant may add its own categories beside these; nobody edits
 * these but a platform reference editor.
 *
 * Flat by design, unlike the 62-node two-level ingredient taxonomy. That one
 * answers "where does this raw material live in the store cupboard"; this
 * answers "which shelf of the shop is this on", and the shop has ten shelves.
 *
 * Committed platform reference data (mechanism (a), D-046): names and codes
 * only. No formulation, no cost, no supplier. Insert-if-absent, so a platform
 * operator's curation of a seeded row survives the next deployment (risk R8).
 */
class ProductCategorySeeder extends Seeder
{
    /**
     * @var list<array{code: string, name_en: string, name_ar: string}>
     */
    private const array CATEGORIES = [
        ['code' => 'poultry', 'name_en' => 'Poultry', 'name_ar' => 'دواجن'],
        ['code' => 'meat', 'name_en' => 'Meat', 'name_ar' => 'لحوم'],
        ['code' => 'frozen', 'name_en' => 'Frozen', 'name_ar' => 'مجمّدات'],
        ['code' => 'sauce', 'name_en' => 'Sauces', 'name_ar' => 'صلصات'],
        ['code' => 'toppings', 'name_en' => 'Toppings', 'name_ar' => 'إضافات'],
        ['code' => 'oil', 'name_en' => 'Oils', 'name_ar' => 'زيوت'],
        ['code' => 'condiment', 'name_en' => 'Condiments', 'name_ar' => 'توابل ومقبلات'],
        ['code' => 'bread', 'name_en' => 'Bread', 'name_ar' => 'خبز'],
        ['code' => 'dairy', 'name_en' => 'Dairy', 'name_ar' => 'ألبان'],
        ['code' => 'vegetables', 'name_en' => 'Vegetables', 'name_ar' => 'خضار'],

        // The v6 workbook's published categories that the original ten did
        // not cover: its meal sheet publishes under "Meal", its beverages and
        // dressings under their own names. "Sauce & Marinade" reuses `sauce`.
        ['code' => 'meal', 'name_en' => 'Meals', 'name_ar' => 'وجبات'],
        ['code' => 'beverage', 'name_en' => 'Beverages', 'name_ar' => 'مشروبات'],
        ['code' => 'dressing', 'name_en' => 'Dressings', 'name_ar' => 'صلصات السلطة'],
    ];

    public function run(): void
    {
        foreach (self::CATEGORIES as $index => $category) {
            ProductCategory::withoutTenancy()->firstOrCreate(
                ['organisation_id' => null, 'code' => $category['code']],
                [
                    'name_en' => $category['name_en'],
                    'name_ar' => $category['name_ar'],
                    'display_order' => $index + 1,
                    'is_active' => true,
                ],
            );
        }
    }
}
