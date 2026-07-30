<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use Healthy360\ReferenceData\Models\Currency;
use Illuminate\Database\Seeder;

/**
 * ISO 4217 currencies. The world set covers every currency referenced as a
 * country's default; only the launch markets' currencies plus USD, EUR and
 * GBP are active. Minor units follow ISO 4217 (three for the Gulf and
 * Jordanian dinars, zero for the CFA francs, yen, won and so on).
 */
class CurrencySeeder extends Seeder
{
    /**
     * @var list<string>
     */
    private const array ACTIVE_CODES = [
        'LBP', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'EGP',
        'USD', 'EUR', 'GBP',
    ];

    public function run(): void
    {
        $rows = [];

        foreach (SeedDataFile::rows('currencies') as $row) {
            $code = SeedDataFile::string($row, 'code');

            $rows[] = [
                'code' => $code,
                'name_en' => SeedDataFile::string($row, 'name_en'),
                'name_ar' => SeedDataFile::stringOr($row, 'name_ar', 'name_en'),
                'minor_units' => SeedDataFile::integer($row, 'minor_units'),
                'is_active' => in_array($code, self::ACTIVE_CODES, true),
            ];
        }

        Currency::query()->upsert($rows, ['code'], ['name_en', 'name_ar', 'minor_units', 'is_active']);
    }
}
