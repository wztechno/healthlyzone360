<?php

declare(strict_types=1);

use Healthy360\Kitchens\Import\Parsers\TechnicalSheetParser;
use Healthy360\Kitchens\Tests\Import\WorkbookFixture;

/*
|--------------------------------------------------------------------------
| Reading a technical sheet exactly as it was typed
|--------------------------------------------------------------------------
|
| The parser's whole job is to read nine hand-typed pages faithfully and then
| say every place they disagree with themselves. So these tests come in two
| halves. The first asserts the reading — a yield of `130 (7 kg)` is 130
| pieces of seven kilograms, a designation is kept misspelled, a legend column
| is not a comment. The second asserts the complaints, because a finding that
| silently stops firing is the failure mode this layer exists to prevent: the
| import still succeeds, and nobody is told the number is wrong.
|
*/

beforeEach(function (): void {
    $this->parsed = TechnicalSheetParser::parse(WorkbookFixture::read(WorkbookFixture::RECIPES));
    $this->sheets = $this->parsed['sheets'];
});

/**
 * @param  array<string, mixed>  $sheet
 * @return list<string>
 */
function codesOf(array $sheet): array
{
    /** @var list<array{code:string, detail:string}> $findings */
    $findings = $sheet['findings'];

    return array_values(array_unique(array_column($findings, 'code')));
}

it('returns every sheet in file order, with the cross-sheet findings kept apart', function (): void {
    expect($this->sheets)->toHaveCount(9)
        ->and(array_column($this->sheets, 'sheet_index'))->toBe([1, 2, 3, 4, 5, 6, 7, 8, 9])
        ->and($this->parsed)->toHaveKeys(['sheets', 'findings']);
});

it('reads the header block and ignores the notices, banners and photo placeholders around it', function (): void {
    expect($this->sheets[0]['designation'])->toBe('Demo Dip Sauce')
        ->and($this->sheets[0]['kind'])->toBe('Sauce')
        ->and($this->sheets[1]['kind'])->toBe('Production')
        ->and($this->sheets[3]['kind'])->toBe('Preparation');
});

it('reads a line by position and keeps the designation exactly as typed', function (): void {
    expect($this->sheets[0]['lines'])->toBe([
        ['row' => 1, 'designation' => 'Mayonnaise', 'unit' => 'kg', 'quantity' => '2', 'unit_price' => '1.11', 'line_total' => '2.22', 'comment' => null],
        ['row' => 2, 'designation' => 'Parsley', 'unit' => 'Kg', 'quantity' => '1.25', 'unit_price' => '2.22', 'line_total' => '2.775', 'comment' => 'Weighed after draining'],
    ]);
});

it('keeps a misspelled designation rather than repairing it', function (): void {
    expect($this->sheets[5]['lines'][1]['designation'])->toBe('Cripsy Spice')
        ->and($this->sheets[4]['lines'][1]['designation'])->toBe('Red Vineagar')
        ->and($this->sheets[4]['lines'][2]['designation'])->toBe('Mustard Dijon');
});

it('expands an exponent quantity without going through a float', function (): void {
    expect($this->sheets[1]['lines'][1])->toMatchArray([
        'designation' => 'Black Pepper',
        'quantity' => '0.002',
        'unit_price' => '12',
        'line_total' => '0.024',
    ]);
});

it('never lets the seventh legend column become a comment', function (): void {
    foreach ($this->sheets[2]['lines'] as $line) {
        expect($line['comment'])->toBeNull();
    }
});

it('reads a five-column sheet without inventing a comment column', function (): void {
    expect($this->sheets[5]['lines'][0])->toBe([
        'row' => 1,
        'designation' => 'Mayonnaise',
        'unit' => 'kg',
        'quantity' => '1.32',
        'unit_price' => '3.33',
        'line_total' => '4.3956',
        'comment' => null,
    ]);
});

it('keeps two lines with the same designation as two lines', function (): void {
    $designations = array_column($this->sheets[2]['lines'], 'designation');

    expect($designations)->toBe(['Flour', 'Milk Liquid', 'Milk Liquid', 'Panko'])
        ->and($this->sheets[2]['lines'][1]['unit'])->toBe('kg')
        ->and($this->sheets[2]['lines'][2]['unit'])->toBe('Piece');
});

/*
|--------------------------------------------------------------------------
| Yields, in all four shapes
|--------------------------------------------------------------------------
*/

it('reads a piece count with its batch mass', function (): void {
    expect($this->sheets[2]['yield'])->toBe([
        'raw' => '130 (7 kg)',
        'label' => 'Quantity Produced',
        'shape' => 'pieces_and_mass',
        'quantity' => '7',
        'unit' => 'kg',
        'piece_count' => 130,
    ]);
});

it('reads a fractional yield as a mass, because a count cannot have a fraction', function (): void {
    expect($this->sheets[1]['yield'])->toBe([
        'raw' => '0.9220',
        'label' => 'Quantity Produced',
        'shape' => 'decimal_mass',
        'quantity' => '0.9220',
        'unit' => 'kg',
        'piece_count' => null,
    ]);
});

it('recognises the Yield and Quantity Produced (Yield) spellings as well as Quantity Produced', function (): void {
    expect($this->sheets[6]['yield']['label'])->toBe('Yield')
        ->and($this->sheets[6]['yield']['quantity'])->toBe('5.75')
        ->and($this->sheets[3]['yield']['label'])->toBe('Quantity Produced (Yield)');
});

it('lets the cost block decide a bare integer, and says that it did', function (): void {
    expect($this->sheets[3]['yield'])->toBe([
        'raw' => '12',
        'label' => 'Quantity Produced (Yield)',
        'shape' => 'bare_integer',
        'quantity' => null,
        'unit' => null,
        'piece_count' => 12,
    ])->and(codesOf($this->sheets[3]))->toContain('yield_shape_ambiguous');

    expect($this->sheets[4]['yield'])->toBe([
        'raw' => '4',
        'label' => 'Quantity Produced',
        'shape' => 'bare_integer',
        'quantity' => '4',
        'unit' => 'kg',
        'piece_count' => null,
    ])->and(codesOf($this->sheets[4]))->toContain('yield_shape_ambiguous');
});

it('names the label that decided an ambiguous yield', function (): void {
    $detail = collect($this->sheets[3]['findings'])->firstWhere('code', 'yield_shape_ambiguous')['detail'];

    expect($detail)->toContain('1 Piece Production Cost')
        ->and($detail)->toContain('read as a piece count');
});

it('reports a sheet with no yield row instead of assuming one', function (): void {
    expect($this->sheets[7]['yield'])->toBe([
        'raw' => null,
        'label' => null,
        'shape' => 'absent',
        'quantity' => null,
        'unit' => null,
        'piece_count' => null,
    ])->and(codesOf($this->sheets[7]))->toContain('yield_missing');
});

/*
|--------------------------------------------------------------------------
| The Total row and the cost block
|--------------------------------------------------------------------------
*/

it('reads the Total row from its own columns', function (): void {
    expect($this->sheets[0]['totals'])->toBe(['input_quantity' => '3.25', 'input_total' => '4.995']);
});

it('reads every row of the cost block verbatim', function (): void {
    expect($this->sheets[0]['cost_labels'])->toBe([
        ['label' => 'Total Production Cost', 'amount' => '5.00'],
        ['label' => 'Cost of 1 kg', 'amount' => '1.54'],
        ['label' => 'Add Waste Coefficient 3%', 'amount' => '1.59'],
    ]);
});

it('reads a cost block that has no Cost divider, and records the difference', function (): void {
    expect($this->sheets[8]['cost_labels'])->toBe([
        ['label' => 'Total Production Cost', 'amount' => '7.50'],
        ['label' => '1 kg Production Cost', 'amount' => '3.00'],
        ['label' => '3% Waste Coeffecient', 'amount' => '3.09'],
    ])
        ->and($this->sheets[8]['waste_percent'])->toBe('3')
        ->and(codesOf($this->sheets[8]))->toContain('cost_block_banner_absent');
});

it('reads the waste coefficient out of either spelling of its label', function (): void {
    // "Add Waste Coefficient 3%" on one sheet, "3% Waste Coeffecient" on the
    // next, misspelling and all.
    expect($this->sheets[0]['waste_percent'])->toBe('3')
        ->and($this->sheets[1]['waste_percent'])->toBe('3');
});

/*
|--------------------------------------------------------------------------
| The complaints
|--------------------------------------------------------------------------
*/

it('reports a line whose stated total is not its quantity times its price', function (): void {
    $finding = collect($this->sheets[4]['findings'])->firstWhere('code', 'line_total_mismatch');

    expect($finding['detail'])->toBe('Sheet 5, row 3 "Mustard Dijon": 0.08 × 6 = 0.48, but the line states 0.45.');
});

it('reports a Total row that does not add up, in either column', function (): void {
    expect(codesOf($this->sheets[4]))
        ->toContain('input_total_mismatch')
        ->toContain('input_quantity_mismatch');
});

it('reports a free ingredient', function (): void {
    $finding = collect($this->sheets[4]['findings'])->firstWhere('code', 'zero_unit_price');

    expect($finding['detail'])->toContain('Red Vineagar')
        ->and($finding['detail'])->toContain('adds nothing');
});

it('reports every unit spelling that is not kg, Piece or L', function (): void {
    $variants = collect($this->sheets)
        ->flatMap(fn (array $sheet): array => $sheet['findings'])
        ->where('code', 'unit_spelling_variant')
        ->pluck('detail');

    expect($variants->filter(fn (string $d): bool => str_contains($d, '"Kg"')))->not->toBeEmpty()
        ->and($variants->filter(fn (string $d): bool => str_contains($d, '"k"')))->not->toBeEmpty()
        ->and($variants->filter(fn (string $d): bool => str_contains($d, '"kg."')))->not->toBeEmpty()
        ->and($variants->filter(fn (string $d): bool => str_contains($d, '"L"')))->toBeEmpty()
        ->and($variants->filter(fn (string $d): bool => str_contains($d, '"Piece"')))->toBeEmpty();
});

it('reports a line counted in pieces whose designation is weighed elsewhere', function (): void {
    $finding = collect($this->sheets[2]['findings'])->firstWhere('code', 'unit_implausible');

    expect($finding['detail'])->toContain('Sheet 3, row 3 "Milk Liquid"')
        ->and($finding['detail'])->toContain('counted in Piece');
});

it('records a blank header cell without losing the column beneath it', function (): void {
    $finding = collect($this->sheets[5]['findings'])->firstWhere('code', 'header_incomplete');

    expect($finding['detail'])->toContain('column 3 (quantity)')
        // The point of the finding: the quantities were still read.
        ->and($this->sheets[5]['lines'][0]['quantity'])->toBe('1.32')
        ->and($this->sheets[5]['lines'][1]['quantity'])->toBe('0.10');
});

it('reports a cost block that quotes a basis its yield cannot supply', function (): void {
    $piece = collect($this->sheets[1]['findings'])->firstWhere('code', 'basis_label_conflict');
    $mass = collect($this->sheets[7]['findings'])->firstWhere('code', 'basis_label_conflict');

    expect($piece['detail'])->toContain('names a piece ("1 Piece Production Cost")')
        ->and($piece['detail'])->toContain('no piece count')
        ->and($mass['detail'])->toContain('names a kilogram ("1 kg Production Cost")')
        ->and($mass['detail'])->toContain('no mass');
});

it('does not complain about a sheet that is internally consistent', function (): void {
    expect(codesOf($this->sheets[6]))->toBe([]);
});

it('reports a sheet with no raw-material block instead of returning it empty', function (): void {
    $parsed = TechnicalSheetParser::parse(<<<'MARKDOWN'
        Sheet4:Technical Sheet

        | Designation | Fixture Headless Prep | Fixture Headless Prep |
        | --- | --- | --- |
        | Kind | Production | Production |
        MARKDOWN);

    expect($parsed['sheets'][0]['lines'])->toBe([])
        ->and(codesOf($parsed['sheets'][0]))->toContain('raw_material_block_missing');
});

/*
|--------------------------------------------------------------------------
| Findings that belong to no single sheet
|--------------------------------------------------------------------------
*/

it('reports two sheets that claim the same designation', function (): void {
    $finding = collect($this->parsed['findings'])->firstWhere('code', 'duplicate_designation_across_sheets');

    expect($finding['detail'])->toContain('"Demo Dip Sauce" is the designation of sheets 1 and 6');
});

it('reports an ingredient priced very differently on different pages', function (): void {
    $outliers = collect($this->parsed['findings'])->where('code', 'unit_price_outlier');

    expect($outliers)->toHaveCount(1)
        ->and($outliers->first()['detail'])
        ->toContain('"Mayonnaise"')
        ->toContain('1.11 (sheet 1)')
        ->toContain('3.33 (sheet 2)')
        ->toContain('3.33 (sheet 6)');
});

it('does not call two prices on one sheet a disagreement between sheets', function (): void {
    // Milk Liquid is 1.5 by the kilogram and 2.4 by the piece on sheet 3.
    // That is how the recipe buys it, not a contradiction between pages.
    $outliers = collect($this->parsed['findings'])->where('code', 'unit_price_outlier')->pluck('detail');

    expect($outliers->filter(fn (string $d): bool => str_contains($d, 'Milk Liquid')))->toBeEmpty();
});

it('does not report a designation whose price is the same everywhere', function (): void {
    $outliers = collect($this->parsed['findings'])->where('code', 'unit_price_outlier')->pluck('detail');

    expect($outliers->filter(fn (string $d): bool => str_contains($d, 'Parsley')))->toBeEmpty();
});

// `raw_material_block_missing` is the one code the fixture cannot provoke —
// every sheet in a real workbook has a raw-material block — so it has its own
// test above, against an inline sheet.
it('fires every finding code the fixture workbook is built to provoke', function (): void {
    $codes = collect($this->sheets)
        ->flatMap(fn (array $sheet): array => $sheet['findings'])
        ->merge($this->parsed['findings'])
        ->pluck('code')
        ->unique()
        ->sort()
        ->values()
        ->all();

    expect($codes)->toBe([
        'basis_label_conflict',
        'cost_block_banner_absent',
        'duplicate_designation_across_sheets',
        'header_incomplete',
        'input_quantity_mismatch',
        'input_total_mismatch',
        'line_total_mismatch',
        'scientific_notation',
        'unit_implausible',
        'unit_price_outlier',
        'unit_spelling_variant',
        'yield_missing',
        'yield_shape_ambiguous',
        'zero_unit_price',
    ]);
});
