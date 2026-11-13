<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Reader\XLSX\Reader as XlsxReader;
use OpenSpout\Writer\XLSX\Writer as XlsxWriter;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| Feature tests and module tests run against the healthy360_test PostgreSQL
| database (phpunit.xml), so both suites get the application test case and
| a refreshed schema.
|
*/

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('../app-modules/*/tests');

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

/**
 * Headers a first-party client sends. Sanctum only issues a cookie session
 * to an origin listed in SANCTUM_STATEFUL_DOMAINS, so a session test that
 * omits these is testing the token path by accident.
 *
 * @return array<string, string>
 */
function firstPartyHeaders(): array
{
    return ['Origin' => 'http://localhost:8081'];
}

/**
 * Emulate the boundary between two HTTP requests.
 *
 * A deployed request cycle resolves its guards from scratch, so the user is
 * re-derived from the cookie or bearer token every time. A test process
 * keeps the resolved guards for the whole test, which would let a user
 * cached from an earlier request survive a logout or a change of credential.
 * Tests that swap credentials call this in between.
 */
function forgetResolvedGuards(): void
{
    app('auth')->forgetGuards();
}

/**
 * An uploaded .xlsx holding `$rows` on its first sheet (first row = headers),
 * as a browser would send it. Values are written as given: a number stays a
 * number cell, a string a text cell (a leading `=` becomes a formula, as
 * openspout decides — the tests never need one).
 *
 * @param  list<list<string|int|float|bool|null>>  $rows
 */
function xlsxUpload(array $rows, string $name = 'sheet.xlsx'): UploadedFile
{
    $path = (string) tempnam(sys_get_temp_dir(), 'h360-test-xlsx-');

    $writer = new XlsxWriter;
    $writer->openToFile($path);

    foreach ($rows as $row) {
        $writer->addRow(Row::fromValues($row));
    }

    $writer->close();

    return new UploadedFile($path, $name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);
}

/**
 * The first sheet of an .xlsx on disk, every cell as a string (or null when
 * empty), for asserting what an export produced.
 *
 * @return list<list<string|null>>
 */
function readXlsx(string $path): array
{
    $reader = new XlsxReader;
    $reader->open($path);

    $rows = [];

    try {
        foreach ($reader->getSheetIterator() as $sheet) {
            foreach ($sheet->getRowIterator() as $row) {
                $rows[] = array_values(array_map(
                    static fn (mixed $value): ?string => $value === null || $value === '' || ! is_scalar($value) ? null : (string) $value,
                    $row->toArray(),
                ));
            }

            break;
        }
    } finally {
        $reader->close();
    }

    return $rows;
}
