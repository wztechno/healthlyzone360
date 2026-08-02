<?php

declare(strict_types=1);

use Healthy360\Kitchens\Import\Support\Numeric;
use Healthy360\Kitchens\Import\Support\SheetReader;
use Healthy360\Kitchens\Tests\Import\WorkbookFixture;

/*
|--------------------------------------------------------------------------
| Reading a spreadsheet without a float in sight
|--------------------------------------------------------------------------
|
| These two helpers sit under every parser in the importer, so a wrong regex
| here does not produce an error — it produces an import that looks fine and
| is out by a factor of a thousand. The exponent cases are the sharp ones:
| `2E-3` appears in four sheets of the real workbook and means 0.002, and a
| reader that returned `2` would make a pinch of pepper into two kilograms of
| it.
|
*/

it('reads the numbers the workbook actually writes', function (string $cell, ?string $expected): void {
    expect(Numeric::parse($cell))->toBe($expected);
})->with([
    'exponent, negative' => ['2E-3', '0.002'],
    'exponent, positive' => ['1.5E2', '150'],
    'exponent, lower case' => ['2e-3', '0.002'],
    'exponent, no fraction left behind' => ['1.25E1', '12.5'],
    'thousands separator' => ['1,234.5', '1234.5'],
    'dollar sign' => ['$4.50', '4.50'],
    'percentage' => ['3%', '3'],
    'blank' => ['', null],
    'em dash' => ['—', null],
    'hyphen' => ['-', null],
    'prose' => ['abc', null],
    'trailing zeros survive' => ['0.9220', '0.9220'],
    'surrounding whitespace' => ['  12  ', '12'],
    'non-breaking space' => ["1\u{00A0}234.5", '1234.5'],
    'explicit plus' => ['+7', '7'],
    'leading point' => ['.5', '0.5'],
    'trailing point' => ['5.', '5'],
    'negative zero' => ['-0', '0'],
    'negative zero with places' => ['-0.00', '0.00'],
    'a real negative' => ['-1.5', '-1.5'],
    'decimal comma is not a thousands separator' => ['1,5', null],
    'an exponent with no mantissa' => ['E2', null],
]);

it('treats a null cell as no number rather than as zero', function (): void {
    expect(Numeric::parse(null))->toBeNull()
        ->and(Numeric::isNumericCell(null))->toBeFalse()
        ->and(Numeric::isScientific(null))->toBeFalse();
});

it('separates "is a number" from "was written as an exponent"', function (): void {
    expect(Numeric::isScientific('2E-3'))->toBeTrue()
        ->and(Numeric::isNumericCell('2E-3'))->toBeTrue()
        ->and(Numeric::isScientific('0.002'))->toBeFalse()
        ->and(Numeric::isScientific('nonsense'))->toBeFalse();
});

it('shortens a number for prose without shortening the value', function (): void {
    expect(Numeric::forDisplay('0.480000000000'))->toBe('0.48')
        ->and(Numeric::forDisplay('1.000000'))->toBe('1')
        ->and(Numeric::forDisplay('150'))->toBe('150')
        ->and(Numeric::forDisplay('0.000000'))->toBe('0');
});

/*
|--------------------------------------------------------------------------
| The shape of a sheet
|--------------------------------------------------------------------------
*/

it('splits a file into sheets by its headings and drops everything else', function (): void {
    $sheets = SheetReader::sheets(WorkbookFixture::read(WorkbookFixture::RECIPES));

    expect($sheets)->toHaveCount(9)
        ->and(array_column($sheets, 'index'))->toBe([1, 2, 3, 4, 5, 6, 7, 8, 9])
        ->and($sheets[0]['title'])->toBe('Technical Sheet');

    // The HTML provenance comment at the top of the fixture, the blank lines
    // and every `| --- |` separator are gone; only table rows survive.
    foreach ($sheets as $sheet) {
        foreach ($sheet['rows'] as $row) {
            expect($row)->not->toBe(['---']);
        }
    }
});

it('keeps a sheet heading that carries no title', function (): void {
    $sheets = SheetReader::sheets(WorkbookFixture::read(WorkbookFixture::PRODUCTS));

    expect($sheets)->toHaveCount(1)
        ->and($sheets[0]['index'])->toBe(1)
        ->and($sheets[0]['title'])->toBe('');
});

it('keeps every column of a row, including the seventh legend column', function (): void {
    $sheets = SheetReader::sheets(WorkbookFixture::read(WorkbookFixture::RECIPES));
    $rows = $sheets[2]['rows'];

    $legend = array_values(array_filter(
        $rows,
        static fn (array $row): bool => ($row[0] ?? '') === 'Milk Liquid' && ($row[1] ?? '') === 'Piece',
    ));

    expect($legend[0])->toHaveCount(7)
        ->and($legend[0][5])->toBe('')
        ->and($legend[0][6])->toBe('Everything is converted to a 1 KG basis for calculation');
});

it('ignores table rows that appear before any sheet heading', function (): void {
    $sheets = SheetReader::sheets("| orphan | row |\n| --- | --- |\nSheet3:Late\n\n| a | b |\n");

    expect($sheets)->toHaveCount(1)
        ->and($sheets[0]['index'])->toBe(3)
        ->and($sheets[0]['rows'])->toBe([['a', 'b']]);
});

it('collapses the repetition a merged cell leaves behind', function (): void {
    expect(SheetReader::collapseRepeats(['Designation', 'Caesar', 'Caesar', '', '', '']))->toBe(['Designation', 'Caesar'])
        ->and(SheetReader::collapseRepeats(['Cost', 'Cost', 'Cost']))->toBe(['Cost'])
        ->and(SheetReader::collapseRepeats(['', '', '']))->toBe([])
        ->and(SheetReader::collapseRepeats(['a', '', 'b', '', '']))->toBe(['a', '', 'b']);
});

it('cannot tell a merge from two equal data cells, which is why line data never goes through it', function (): void {
    // A line whose unit price and line total are both 0.3 collapses to one
    // cell. That is unavoidable — the export gives a merge and a coincidence
    // the same shape — and it is the reason the technical-sheet parser reads
    // its lines from the raw row by position and uses collapseRepeats() only
    // to recognise banners.
    expect(SheetReader::collapseRepeats(['Salt', 'kg', '1', '0.3', '0.3']))->toBe(['Salt', 'kg', '1', '0.3']);
});

it('recognises a merged banner by its repetition, not by its wording', function (): void {
    expect(SheetReader::isMergedBanner(['Cost', 'Cost', 'Cost', 'Cost']))->toBeTrue()
        ->and(SheetReader::isMergedBanner(['notice', 'notice', '', '']))->toBeTrue()
        ->and(SheetReader::isMergedBanner(['Designation', 'Caesar', 'Caesar']))->toBeFalse()
        ->and(SheetReader::isMergedBanner(['Total Production Cost', '13.83', '0', '0']))->toBeFalse();
});

it('reads a blank cell as an absent one', function (): void {
    expect(SheetReader::cell(['a', '', 'c'], 0))->toBe('a')
        ->and(SheetReader::cell(['a', '', 'c'], 1))->toBeNull()
        ->and(SheetReader::cell(['a', '', 'c'], 9))->toBeNull();
});

it('folds whitespace and case for matching but never for storing', function (): void {
    expect(SheetReader::fold('  Cleansing   Plan '))->toBe('cleansing plan')
        ->and(SheetReader::fold('Frozen '))->toBe('frozen')
        ->and(SheetReader::fold(null))->toBe('');
});
