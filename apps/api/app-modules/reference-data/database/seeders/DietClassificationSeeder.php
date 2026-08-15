<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use Healthy360\ReferenceData\Models\DietClassification;
use Illuminate\Database\Seeder;

/**
 * The platform diet vocabulary — twelve codes, matching the frontend's
 * `DIET_CLASSIFICATIONS` union 1:1.
 *
 * **Twelve, not the source workbook's nine.** The Customer-Data-Structure
 * source lists nine diet types; the frontend contract carries twelve, and the
 * twelve are the superset. Every source value folds into one of these codes —
 * the workbook's "vegetarian", "vegan", "keto", "low carb", "high protein",
 * "mediterranean", "gluten free", "dairy free" and "nut free" map directly —
 * and the three the workbook lacks (`omnivore`, `pescatarian`,
 * `halal_friendly`) are the ones a customer needs in order to describe
 * themselves at all. Seeding the union means the import never has to invent a
 * code, and the closed union a screen is written against is exactly what the
 * database holds. A mismatch between the two is asserted against by test, in
 * both directions.
 *
 * **The Arabic is authored, not machine-translated** (master plan v2 §4.18),
 * and it is **pending native review**: these are a competent translator's
 * renderings of marketing vocabulary, not a regulator's, and a platform
 * reference editor is expected to correct them before the first Arabic-facing
 * launch. The seeder is insert-if-absent, so that correction survives the next
 * deployment (risk R8) — which is precisely why the review can happen in the
 * database rather than in a pull request.
 *
 * A classification is a **preference filter, never a medical restriction**.
 * `gluten_free` here means the kitchen sells this as part of a gluten-free
 * line; what a dish actually contains is its derived allergen set. The two are
 * never each other's evidence.
 */
class DietClassificationSeeder extends Seeder
{
    /**
     * @var list<array{code: string, name_en: string, name_ar: string}>
     */
    private const array CLASSIFICATIONS = [
        ['code' => 'omnivore', 'name_en' => 'Omnivore', 'name_ar' => 'نظام غذائي متنوّع'],
        ['code' => 'vegetarian', 'name_en' => 'Vegetarian', 'name_ar' => 'نباتي'],
        ['code' => 'vegan', 'name_en' => 'Vegan', 'name_ar' => 'نباتي صرف'],
        ['code' => 'pescatarian', 'name_en' => 'Pescatarian', 'name_ar' => 'نباتي مع الأسماك'],
        ['code' => 'keto', 'name_en' => 'Keto', 'name_ar' => 'كيتو'],
        ['code' => 'low_carb', 'name_en' => 'Low carbohydrate', 'name_ar' => 'قليل الكربوهيدرات'],
        ['code' => 'high_protein', 'name_en' => 'High protein', 'name_ar' => 'عالي البروتين'],
        ['code' => 'mediterranean', 'name_en' => 'Mediterranean', 'name_ar' => 'حمية البحر المتوسط'],
        ['code' => 'halal_friendly', 'name_en' => 'Halal friendly', 'name_ar' => 'متوافق مع الحلال'],
        ['code' => 'gluten_free', 'name_en' => 'Gluten free', 'name_ar' => 'خالٍ من الغلوتين'],
        ['code' => 'dairy_free', 'name_en' => 'Dairy free', 'name_ar' => 'خالٍ من الألبان'],
        ['code' => 'nut_free', 'name_en' => 'Nut free', 'name_ar' => 'خالٍ من المكسرات'],
    ];

    public function run(): void
    {
        foreach (self::CLASSIFICATIONS as $index => $classification) {
            // Insert-if-absent rather than upsert: a platform reference
            // editor's correction of an Arabic name must survive the next
            // deployment (risk R8). `firstOrCreate` is the whole mechanism —
            // an `updateOrCreate` here would overwrite exactly the review this
            // vocabulary is waiting for.
            DietClassification::query()->firstOrCreate(
                ['code' => $classification['code']],
                [
                    'name_en' => $classification['name_en'],
                    'name_ar' => $classification['name_ar'],
                    'display_order' => $index + 1,
                    'is_active' => true,
                ],
            );
        }
    }
}
