<?php

declare(strict_types=1);

use Healthy360\ReferenceData\Database\Seeders\DeliveryAreaSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Database\Seeders\SeedDataFile;
use Healthy360\ReferenceData\Models\DeliveryArea;

/*
|--------------------------------------------------------------------------
| The Lebanese delivery gazetteer
|--------------------------------------------------------------------------
|
| 125 zone names transcribed verbatim from the source workbook (Customer Data
| Structure, Sheet4 §5). Committed platform reference data — mechanism (a) —
| because place names are not confidential, are not one kitchen's data, and
| every tenant needs the same list.
|
| The interesting assertions are the ones about restraint: the count is what
| the source says, the spellings are the source's including the one that is
| probably wrong, `region` is empty because the source does not say, and a
| re-run does not overwrite a platform editor's corrections.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
});

it('seeds exactly the 125 areas the source lists', function (): void {
    $this->seed(DeliveryAreaSeeder::class);

    expect(DeliveryArea::query()->where('country_code', 'LB')->count())->toBe(125)
        // The count follows the data. A gazetteer that grew a 126th row would
        // mean somebody invented a place.
        ->and(DeliveryArea::query()->count())->toBe(125);
});

it('keeps the source spelling of Beirut Airpot and flags it in the data file', function (): void {
    // Appendix D data-quality finding 25. A place name that a transcription
    // "fixes" is indistinguishable from a *different* place: the importer
    // matches on what the source says, and a customer who picked "Beirut
    // Airpot" last month must still resolve to the same row. Correcting it is
    // a deliberate reference-data edit, not something a seeder decides.
    $this->seed(DeliveryAreaSeeder::class);

    $area = DeliveryArea::query()->where('country_code', 'LB')->where('code', 'beirut-airpot')->sole();

    expect($area->name_en)->toBe('Beirut Airpot');

    // The flag travels with the data rather than living only in a docblock, so
    // whoever eventually corrects the row can see why it was left alone.
    $flagged = collect(SeedDataFile::rowsIn(
        dirname(__DIR__).'/database/data',
        'delivery-areas',
    ))->firstWhere('code', 'beirut-airpot');

    expect($flagged['data_quality_note'] ?? null)->toBeString()
        ->and($flagged['data_quality_note'])->toContain('Airport');
});

it('leaves every region empty rather than inventing a grouping', function (): void {
    // OD-12. The workbook files all 125 under one heading and never says which
    // governorate a name belongs to; an invented grouping would look exactly
    // like data and be wrong about half the time.
    $this->seed(DeliveryAreaSeeder::class);

    expect(DeliveryArea::query()->whereNotNull('region')->count())->toBe(0);
});

it('falls back to the English name where the source carries no Arabic', function (): void {
    // The pattern CountrySeeder and MeasurementUnitSeeder already use.
    // Transliterating 125 Lebanese place names is a job for somebody who knows
    // the towns, and a machine translation would be worse than an honest
    // English placeholder.
    $this->seed(DeliveryAreaSeeder::class);

    $area = DeliveryArea::query()->where('code', 'achrafieh')->sole();

    expect($area->name_ar)->toBe($area->name_en);
});

it('preserves the source order in display_order', function (): void {
    $this->seed(DeliveryAreaSeeder::class);

    $first = DeliveryArea::query()->where('country_code', 'LB')->orderBy('display_order')->first();
    $last = DeliveryArea::query()->where('country_code', 'LB')->orderByDesc('display_order')->first();

    expect($first?->name_en)->toBe('Aatchaneh')
        ->and($first?->display_order)->toBe(1)
        ->and($last?->name_en)->toBe('Zaarour')
        ->and($last?->display_order)->toBe(125);
});

it('converges rather than duplicating on a second run', function (): void {
    $this->seed(DeliveryAreaSeeder::class);
    $this->seed(DeliveryAreaSeeder::class);

    expect(DeliveryArea::query()->where('country_code', 'LB')->count())->toBe(125);
});

it('never overwrites an editor correction on a re-run', function (): void {
    // Risk R8, and the reason this seeder is insert-if-absent rather than an
    // upsert: the Arabic here is waiting to be corrected by a platform
    // reference editor and the region column is waiting to be filled in. An
    // upsert would erase both on the next deployment, which would make the
    // correction impossible anywhere except a pull request.
    $this->seed(DeliveryAreaSeeder::class);

    DeliveryArea::query()->where('code', 'achrafieh')->update([
        'name_ar' => 'الأشرفية',
        'region' => 'Beirut',
    ]);

    $this->seed(DeliveryAreaSeeder::class);

    $area = DeliveryArea::query()->where('code', 'achrafieh')->sole();

    expect($area->name_ar)->toBe('الأشرفية')
        ->and($area->region)->toBe('Beirut');
});

it('gives every area a code unique within its country', function (): void {
    $this->seed(DeliveryAreaSeeder::class);

    $codes = DeliveryArea::query()->where('country_code', 'LB')->pluck('code')->all();

    expect($codes)->toHaveCount(125)
        ->and(array_unique($codes))->toHaveCount(125);
});
