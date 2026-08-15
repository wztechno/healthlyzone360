<?php

declare(strict_types=1);

namespace Database\Seeders;

use Healthy360\Allergens\Database\Seeders\AllergenSeeder;
use Healthy360\Catalogues\Database\Seeders\ProductCategorySeeder;
use Healthy360\Ingredients\Database\Seeders\IngredientMasterSeeder;
use Healthy360\ReferenceData\Database\Seeders\DeliveryAreaSeeder;
use Illuminate\Database\Seeder;

/**
 * Platform reference data for the kitchen programme — committed,
 * production-safe, non-confidential (data register, mechanism (a) / D-046).
 *
 * Runs immediately after `ReferenceDataSeeder` and before anything
 * tenant-shaped: the ingredient master needs measurement units, and the
 * allergen classes have to exist before any mapping can point at one.
 *
 * The product taxonomy (K1.4) joins here rather than in `ReferenceDataSeeder`
 * because it is a `product_categories` row with a nullable `organisation_id` —
 * a platform *library* inside a tenant-shaped table, like the ingredient
 * categories beside it — rather than a pure platform vocabulary.
 *
 * The delivery gazetteer (K1.7) joins on the opposite argument: it *is* a pure
 * platform vocabulary and would sit just as well in `ReferenceDataSeeder`, but
 * it is kitchen-programme data by provenance — 125 names transcribed from the
 * same workbook as the allergen classes and the ingredient master — and
 * keeping the K1 reference load in one place is what lets a deployment reason
 * about it as one thing. It depends on `CountrySeeder` for its `LB` foreign
 * key, which `ReferenceDataSeeder` has already run.
 */
class KitchenReferenceSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            AllergenSeeder::class,
            IngredientMasterSeeder::class,
            ProductCategorySeeder::class,
            DeliveryAreaSeeder::class,
        ]);
    }
}
