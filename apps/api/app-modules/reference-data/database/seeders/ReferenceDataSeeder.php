<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use Illuminate\Database\Seeder;

/**
 * Reference-data module entry point. Currencies come first: countries carry
 * a default_currency_code foreign key.
 */
class ReferenceDataSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            CurrencySeeder::class,
            CountrySeeder::class,
            LanguageSeeder::class,
            MeasurementUnitSeeder::class,
        ]);
    }
}
