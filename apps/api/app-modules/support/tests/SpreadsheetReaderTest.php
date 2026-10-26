<?php

declare(strict_types=1);

use Healthy360\Support\Spreadsheet\ImportResult;
use Healthy360\Support\Spreadsheet\SpreadsheetReader;
use Healthy360\Support\Spreadsheet\SpreadsheetWriter;
use Illuminate\Validation\ValidationException;

/*
|--------------------------------------------------------------------------
| The spreadsheet seam
|--------------------------------------------------------------------------
|
| Every catalogue import reads through SpreadsheetReader and every export
| writes through SpreadsheetWriter, so what is pinned here is what a person
| editing a sheet in Excel can rely on: loose headers, true row numbers,
| blank lines that do not count, and a 422 on `file` for anything that is
| not a workbook — never a 500.
|
*/

const SHEET_COLUMNS = ['name_en' => 'Name (EN)', 'price' => 'Price', 'sku' => 'SKU'];

/**
 * @param  list<list<string|int|float|bool|null>>  $rows
 * @return array{rows: list<array{row: int, values: array<string, string|null>, example: bool}>, ignored_columns: list<string>}
 */
function readSheet(array $rows, int $maxRows = 1000): array
{
    return app(SpreadsheetReader::class)->read(xlsxUpload($rows)->getPathname(), SHEET_COLUMNS, ['name_en', 'sku'], $maxRows);
}

/**
 * @return array<string, list<string>>
 */
function sheetErrors(Closure $read): array
{
    try {
        $read();
    } catch (ValidationException $e) {
        return $e->errors();
    }

    throw new RuntimeException('Expected the read to be refused.');
}

it('matches headers loosely, by template text or by key', function (string $header): void {
    $sheet = readSheet([[$header], ['Falafel']]);

    expect($sheet['rows'])->toBe([['row' => 2, 'values' => ['name_en' => 'Falafel'], 'example' => false]]);
})->with(['NAME_en', 'Name (EN)', 'name en', 'name_en']);

it('lists headers it does not know without refusing the sheet', function (): void {
    $sheet = readSheet([['Name (EN)', 'Colour', 'Price'], ['Falafel', 'green', 12]]);

    expect($sheet['ignored_columns'])->toBe(['Colour'])
        ->and($sheet['rows'][0]['values'])->toBe(['name_en' => 'Falafel', 'price' => '12']);
});

it('refuses a column that appears twice', function (): void {
    $errors = sheetErrors(fn () => readSheet([['Name (EN)', 'name_en'], ['Falafel', 'Hummus']]));

    expect($errors)->toHaveKey('file');
});

it('refuses a header row that has none of the required columns', function (): void {
    $errors = sheetErrors(fn () => readSheet([['Price'], [12]]));

    expect($errors['file'][0])->toContain('"Name (EN)"')->toContain('"SKU"');
});

it('skips blank rows and keeps the row numbers the sheet shows', function (): void {
    $sheet = readSheet([
        [null, null],
        ['Name (EN)', 'SKU'],
        ['Falafel', 'F-1'],
        [null, null],
        ['   ', ''],
        ['Hummus', 'H-1'],
        [null, null],
        [null, null],
    ]);

    expect(array_column($sheet['rows'], 'row'))->toBe([3, 6])
        ->and(array_column($sheet['rows'], 'values'))->toBe([
            ['name_en' => 'Falafel', 'sku' => 'F-1'],
            ['name_en' => 'Hummus', 'sku' => 'H-1'],
        ]);
});

it('normalises cells to trimmed strings, integral floats without a decimal point', function (): void {
    $sheet = readSheet([['Name (EN)', 'Price', 'SKU'], ['  Falafel  ', 7.0, 42], ['Hummus', 7.5, true]]);

    expect($sheet['rows'][0]['values'])->toBe(['name_en' => 'Falafel', 'price' => '7', 'sku' => '42'])
        ->and($sheet['rows'][1]['values'])->toBe(['name_en' => 'Hummus', 'price' => '7.5', 'sku' => '1']);
});

it('flags the template example row', function (): void {
    $sheet = readSheet([['Name (EN)', 'SKU'], [' example ', 'X-1'], ['Falafel', 'F-1']]);

    expect(array_column($sheet['rows'], 'example'))->toBe([true, false]);
});

it('refuses a sheet with more rows than allowed', function (): void {
    $errors = sheetErrors(fn () => readSheet([['Name (EN)'], ['A'], [null], ['B'], ['C']], maxRows: 2));

    expect($errors['file'])->toBe(['Split the sheet: at most 2 rows per file.']);
});

it('accepts a sheet with exactly as many rows as allowed', function (): void {
    expect(readSheet([['Name (EN)'], ['A'], ['B']], maxRows: 2)['rows'])->toHaveCount(2);
});

it('answers 422 on file for something that is not a workbook', function (): void {
    $path = (string) tempnam(sys_get_temp_dir(), 'h360-test-txt-');
    file_put_contents($path, "name,price\nFalafel,12\n");

    $errors = sheetErrors(fn () => app(SpreadsheetReader::class)->read($path, SHEET_COLUMNS, ['name_en']));

    expect($errors)->toBe(['file' => ['Not a readable .xlsx file.']]);

    unlink($path);
});

it('counts unchanged rows without listing them', function (): void {
    $result = new ImportResult;
    $result->ignoredColumns(['Colour']);
    $result->created(2, 'F-1');
    $result->unchanged();
    $result->unchanged();
    $result->updated(4, 'H-1');
    $result->skipped(5, null, 'Example row.');
    $result->failed(6, 'X-1', 'Price must be a number.');

    expect($result->toArray())->toBe([
        'created' => 1,
        'updated' => 1,
        'unchanged' => 2,
        'skipped' => 1,
        'failed' => 1,
        'ignored_columns' => ['Colour'],
        'rows' => [
            ['row' => 2, 'outcome' => 'created', 'reference' => 'F-1', 'message' => null],
            ['row' => 4, 'outcome' => 'updated', 'reference' => 'H-1', 'message' => null],
            ['row' => 5, 'outcome' => 'skipped', 'reference' => null, 'message' => 'Example row.'],
            ['row' => 6, 'outcome' => 'failed', 'reference' => 'X-1', 'message' => 'Price must be a number.'],
        ],
    ])->and($result->count('unchanged'))->toBe(2);
});

it('answers an export as an xlsx attachment that reads back to its rows, formulas as text', function (): void {
    $response = app(SpreadsheetWriter::class)->download('meals.xlsx', ['Name (EN)', 'Price'], [
        ['Falafel', 12],
        [null, '=1+1'],
    ]);

    $path = $response->getFile()->getPathname();

    expect($response->headers->get('Content-Type'))->toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        ->and($response->headers->get('Content-Disposition'))->toContain('attachment')->toContain('meals.xlsx')
        ->and(readXlsx($path))->toBe([
            ['Name (EN)', 'Price'],
            ['Falafel', '12'],
            [null, '=1+1'],
        ]);

    unlink($path);
});
