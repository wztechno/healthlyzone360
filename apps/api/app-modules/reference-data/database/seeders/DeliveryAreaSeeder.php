<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use Healthy360\ReferenceData\Models\DeliveryArea;
use Illuminate\Database\Seeder;

/**
 * The Lebanese delivery gazetteer — the 125 zone names the source workbook
 * lists (Customer Data Structure, Sheet4 §5), transcribed verbatim.
 *
 * **Mechanism (a): a committed platform reference seeder** (D-046). Place
 * names are not confidential, they are not one kitchen's data, and every
 * tenant needs the same list — which is exactly the test that separates this
 * from the formulations and costs that may only arrive through the private
 * importer.
 *
 * **Verbatim, including the spelling that is probably wrong.** `Beirut
 * Airpot` is seeded as written and flagged in the data file's
 * `data_quality_note` (appendix D, finding 25). The rule is worth stating
 * because it is not obvious: a place name that a transcription "fixes" is
 * indistinguishable from a *different* place, the importer matches on what
 * the source says, and a customer who picked "Beirut Airpot" last month must
 * still resolve to the same row. Correcting it is a reference-data edit a
 * platform operator makes deliberately, in the database, once somebody has
 * confirmed it — not something a seeder decides on their behalf.
 *
 * **Arabic falls back to English**, the pattern `CountrySeeder` and
 * `MeasurementUnitSeeder` already use. The source carries no Arabic for these
 * names, and a machine translation of 125 Lebanese place names would be worse
 * than an honest English placeholder: transliterating "Sed el bauchrieh" back
 * into Arabic script is a job for somebody who knows the town.
 *
 * **Insert-if-absent, never upsert** (risk R8). The Arabic here is waiting to
 * be corrected by a platform reference editor and the region column is waiting
 * to be filled in; an `upsert` would erase both on the next deployment, which
 * would make the correction impossible anywhere except a pull request. The
 * consequence is deliberate: a change to `delivery-areas.json` adds rows and
 * does not rewrite existing ones.
 *
 * **`region` is left NULL** (OD-12). The workbook groups all 125 under one
 * heading and never says which governorate a name belongs to.
 *
 * Production-safe: idempotent, non-confidential, and it writes only rows whose
 * country already exists (`LB` is a launch market, seeded by `CountrySeeder`).
 */
class DeliveryAreaSeeder extends Seeder
{
    /**
     * The gazetteer is Lebanese today. A second market is a second data file
     * beside this one, not a rewrite of this seeder — which is why the country
     * is a constant rather than a value read from each row.
     */
    public const string COUNTRY_CODE = 'LB';

    public function run(): void
    {
        foreach (SeedDataFile::rows('delivery-areas') as $row) {
            $code = SeedDataFile::string($row, 'code');
            $nameEn = SeedDataFile::string($row, 'name_en');

            DeliveryArea::query()->firstOrCreate(
                ['country_code' => self::COUNTRY_CODE, 'code' => $code],
                [
                    'name_en' => $nameEn,
                    'name_ar' => SeedDataFile::stringOr($row, 'name_ar', 'name_en'),
                    'region' => null,
                    'display_order' => SeedDataFile::integer($row, 'display_order'),
                    'is_active' => true,
                ],
            );
        }
    }
}
