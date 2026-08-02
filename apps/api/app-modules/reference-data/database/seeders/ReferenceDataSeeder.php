<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use Illuminate\Database\Seeder;

/**
 * Reference-data module entry point. Currencies come first: countries carry
 * a default_currency_code foreign key.
 *
 * Diet classifications join the layer in K1.4. They belong here rather than
 * with the catalogue seeders because they are a platform vocabulary a kitchen
 * tags against and never writes — the same standing as measurement units and
 * allergen classes — and because a public, anonymous endpoint serves them.
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
            DietClassificationSeeder::class,
        ]);
    }
}
