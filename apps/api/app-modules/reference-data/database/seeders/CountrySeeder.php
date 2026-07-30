<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use Healthy360\ReferenceData\Models\Country;
use Illuminate\Database\Seeder;

/**
 * Every ISO 3166-1 alpha-2 country is seeded, but only the approved launch
 * markets are active (plan §2). Arabic names are supplied for the launch
 * nine and fall back to the English name elsewhere until translations are
 * commissioned.
 *
 * Depends on CurrencySeeder: default_currency_code is a foreign key.
 */
class CountrySeeder extends Seeder
{
    /**
     * The approved launch markets (plan §2).
     *
     * @var list<string>
     */
    public const array LAUNCH_MARKETS = ['LB', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'JO', 'EG'];

    public function run(): void
    {
        $rows = [];

        foreach (SeedDataFile::rows('countries') as $row) {
            $code = SeedDataFile::string($row, 'code');

            $rows[] = [
                'code' => $code,
                'name_en' => SeedDataFile::string($row, 'name_en'),
                'name_ar' => SeedDataFile::stringOr($row, 'name_ar', 'name_en'),
                'default_currency_code' => SeedDataFile::nullableString($row, 'currency'),
                'is_active' => in_array($code, self::LAUNCH_MARKETS, true),
            ];
        }

        Country::query()->upsert($rows, ['code'], ['name_en', 'name_ar', 'default_currency_code', 'is_active']);
    }
}
