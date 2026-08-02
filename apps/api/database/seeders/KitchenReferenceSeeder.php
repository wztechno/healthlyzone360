<?php

declare(strict_types=1);

namespace Database\Seeders;

use Healthy360\Allergens\Database\Seeders\AllergenSeeder;
use Healthy360\Ingredients\Database\Seeders\IngredientMasterSeeder;
use Illuminate\Database\Seeder;

/**
 * Platform reference data for the kitchen programme — committed,
 * production-safe, non-confidential (data register, mechanism (a) / D-046).
 *
 * Runs immediately after `ReferenceDataSeeder` and before anything
 * tenant-shaped: the ingredient master needs measurement units, and the
 * allergen classes have to exist before any mapping can point at one.
 */
class KitchenReferenceSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            AllergenSeeder::class,
            IngredientMasterSeeder::class,
        ]);
    }
}
