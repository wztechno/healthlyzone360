<?php

declare(strict_types=1);

use Healthy360\Kitchens\Import\Parsers\ProductListParser;
use Healthy360\Kitchens\Tests\Import\WorkbookFixture;

/*
|--------------------------------------------------------------------------
| Reading a product list whose pack column is four columns in a trench coat
|--------------------------------------------------------------------------
|
| Every hard case here is a free-text cell that encodes more than one fact:
| a size, a container, a piece count, sometimes two whole packs. The tests
| below pin the exact output for each shape, because the failure mode is not
| an exception — it is a product that quietly ships at the wrong pack size or
| the wrong price.
|
*/

beforeEach(function (): void {
    $this->parsed = ProductListParser::parse(WorkbookFixture::read(WorkbookFixture::PRODUCTS));
    $this->rows = $this->parsed['rows'];
    $this->findings = collect($this->parsed['findings']);
});

/**
 * @param  list<array<string, mixed>>  $rows
 * @return array<string, mixed>
 */
function productRow(array $rows, string $name): array
{
    foreach ($rows as $row) {
        if ($row['product'] === $name) {
            return $row;
        }
    }

    throw new RuntimeException("No fixture product named [{$name}].");
}

it('reads every data row and numbers them from one', function (): void {
    expect($this->rows)->toHaveCount(17)
        ->and($this->rows[0]['row'])->toBe(1)
        ->and($this->rows[16]['row'])->toBe(17);
});

it('normalises the kind and the category while keeping what the source typed', function (): void {
    $oil = productRow($this->rows, 'Fixture Table Oil');
    $cheese = productRow($this->rows, 'Fixture Cheese Block');
    $patty = productRow($this->rows, 'Americain Fixture Patty');

    expect($oil['kind'])->toBe('supplier')
        ->and($oil['kind_verbatim'])->toBe('Supllier')
        ->and($cheese['category_code'])->toBe('dairy')
        ->and($cheese['category_verbatim'])->toBe('Diary')
        ->and($patty['kind'])->toBe('both');
});

it('maps a category whose source spelling carries a trailing space', function (): void {
    // The source cell reads `Frozen ` with a trailing space. `SheetReader`
    // trims every cell as it reads it, so the verbatim value stored here is
    // already trimmed — the trailing space is a rendering artefact of the
    // export, not a fact about the category, and no operator would ever want
    // to see it in a report.
    expect(productRow($this->rows, 'Fixture Crumb Ball')['category_verbatim'])->toBe('Frozen')
        ->and(productRow($this->rows, 'Fixture Crumb Ball')['category_code'])->toBe('frozen');
});

it('records a category it cannot map rather than guessing one', function (): void {
    expect(productRow($this->rows, 'Fixture Mystery Item')['category_code'])->toBeNull()
        ->and($this->findings->where('code', 'category_unmapped')->pluck('source_ref')->all())->toBe(['Fixture Mystery Item']);
});

it('records a kind it cannot map rather than guessing one', function (): void {
    expect(productRow($this->rows, 'Fixture Trial Item')['kind'])->toBeNull()
        ->and(productRow($this->rows, 'Fixture Trial Item')['kind_verbatim'])->toBe('Externally Sourced')
        ->and($this->findings->where('code', 'kind_unmapped')->pluck('source_ref')->all())->toBe(['Fixture Trial Item']);
});

/*
|--------------------------------------------------------------------------
| Packs
|--------------------------------------------------------------------------
*/

it('reads a pack label into its size, container, piece count and mass', function (string $product, array $expected): void {
    expect(productRow($this->rows, $product)['packs'])->toContain($expected);
})->with([
    'a plain kilogram' => ['Demo Dip Sauce', ['code' => '1-kg', 'label' => '1 kg', 'quantity' => '1', 'unit' => 'kg', 'piece_count' => null, 'format' => 'loose', 'net_weight_grams' => 1000]],
    'a bottle' => ['Demo Dip Sauce', ['code' => '300-g', 'label' => '300 g (bottle)', 'quantity' => '300', 'unit' => 'g', 'piece_count' => null, 'format' => 'bottle', 'net_weight_grams' => 300]],
    'a bag of pieces' => ['Fixture Bun', ['code' => '1-bag-6-piece', 'label' => '1 Bag (6 Piece)', 'quantity' => '1', 'unit' => 'Bag', 'piece_count' => 6, 'format' => 'bag', 'net_weight_grams' => null]],
    'a bag stated by mass' => ['Fixture Pickle Bag', ['code' => '1-bag-2-6-kg', 'label' => '1 bag (2.6 kg)', 'quantity' => '1', 'unit' => 'bag', 'piece_count' => null, 'format' => 'bag', 'net_weight_grams' => 2600]],
    'a gallon with a volume' => ['Fixture Fryer Oil', ['code' => '1-gallon-5-l', 'label' => '1 Gallon (5 L)', 'quantity' => '1', 'unit' => 'Gallon', 'piece_count' => null, 'format' => 'gallon', 'net_weight_grams' => null]],
    'a can' => ['Fixture Relish Can', ['code' => '1-can', 'label' => '1 Can', 'quantity' => '1', 'unit' => 'Can', 'piece_count' => null, 'format' => 'can', 'net_weight_grams' => null]],
    'a bunch' => ['Lettuce, Parsley, Coriander…. (all Kinds)', ['code' => '1-bunch', 'label' => '1 Bunch', 'quantity' => '1', 'unit' => 'Bunch', 'piece_count' => null, 'format' => 'bunch', 'net_weight_grams' => null]],
    'a litre, which is not a mass' => ['Fixture Cream Pot', ['code' => '1-l', 'label' => '1 L', 'quantity' => '1', 'unit' => 'L', 'piece_count' => null, 'format' => 'loose', 'net_weight_grams' => null]],
    'a three-decimal weight' => ['Fixture Kitchen Patty', ['code' => '1-03-kg', 'label' => '1.03 KG', 'quantity' => '1.03', 'unit' => 'KG', 'piece_count' => null, 'format' => 'loose', 'net_weight_grams' => 1030]],
]);

it('splits a dual pack into two packs and prices them positionally', function (): void {
    $row = productRow($this->rows, 'Fixture Cheese Stick');

    expect(array_column($row['packs'], 'code'))->toBe(['1-kg', '0-5-kg'])
        ->and($row['prices'])->toBe([
            ['channel' => 'b2b', 'pack_code' => '1-kg', 'amount_minor' => 700, 'status' => 'confirmed', 'note' => null],
            ['channel' => 'b2c', 'pack_code' => '0-5-kg', 'amount_minor' => 550, 'status' => 'confirmed', 'note' => null],
            ['channel' => 'b2c', 'pack_code' => '1-kg', 'amount_minor' => 1000, 'status' => 'confirmed', 'note' => null],
        ]);
});

it('gives a pack written with and without a space the same code', function (): void {
    // The B2C cell of this row reads "0.5kg/1 kg"; the B2B cell reads "1 kg".
    expect(array_column(productRow($this->rows, 'Fixture Cheese Stick')['packs'], 'code'))
        ->toBe(['1-kg', '0-5-kg']);
});

it('prices only the larger pack when a dual pack carries one price', function (): void {
    $row = productRow($this->rows, 'Fixture Crumb Ball');
    $b2c = array_values(array_filter($row['prices'], static fn (array $p): bool => $p['channel'] === 'b2c'));

    expect($b2c)->toHaveCount(1)
        ->and($b2c[0]['pack_code'])->toBe('1-kg')
        ->and($b2c[0]['amount_minor'])->toBe(1200)
        ->and($b2c[0]['note'])->toContain('larger pack')
        ->and($row['flags'])->toContain('dual_pack_single_price')
        ->and($this->findings->where('code', 'dual_pack_single_price')->pluck('source_ref')->all())->toBe(['Fixture Crumb Ball']);
});

/*
|--------------------------------------------------------------------------
| Prices
|--------------------------------------------------------------------------
*/

it('converts dollars to whole cents with string arithmetic', function (): void {
    expect(productRow($this->rows, 'Fixture Cheese Stick')['prices'][1]['amount_minor'])->toBe(550)
        ->and(productRow($this->rows, 'Demo Dip Sauce')['prices'][1]['amount_minor'])->toBe(250)
        ->and(productRow($this->rows, 'Fixture Mystery Item')['prices'][0]['amount_minor'])->toBe(111);
});

it('reports a price that is not a whole number of cents instead of truncating it', function (): void {
    $finding = $this->findings->firstWhere('code', 'price_sub_cent_rounded');

    expect(productRow($this->rows, 'Fixture Mystery Item')['prices'][1]['amount_minor'])->toBe(56)
        ->and($finding['detail'])->toContain('0.555')
        ->and($finding['detail'])->toContain('rounded to 56');
});

it('produces a null-amount market-priced row per pack rather than a zero or nothing', function (): void {
    $row = productRow($this->rows, 'Cucumber, Tomato, Onion, carrot…....( All Kinds)');

    expect($row['is_market_priced'])->toBeTrue()
        ->and($row['flags'])->toContain('market_priced')
        ->and($row['prices'])->toBe([[
            'channel' => 'b2b',
            'pack_code' => '1-kg',
            'amount_minor' => null,
            'status' => 'market_priced',
            'note' => 'Depends on each day',
        ]]);
});

it('reads pack text in the price column as a missing price, not as a price', function (): void {
    $row = productRow($this->rows, 'Fixture Kitchen Patty');
    $b2b = array_filter($row['prices'], static fn (array $p): bool => $p['channel'] === 'b2b');

    expect($b2b)->toBeEmpty()
        ->and($row['flags'])->toContain('price_cell_is_pack_text')
        ->and($this->findings->firstWhere('code', 'price_cell_is_pack_text')['detail'])->toContain('1 bag (10 piece)')
        // The B2C side of the same row is unaffected.
        ->and($row['prices'][0])->toMatchArray(['channel' => 'b2c', 'pack_code' => '1-bag-6-piece', 'amount_minor' => 1500]);
});

it('tells a declined channel apart from a forgotten one', function (): void {
    $declined = productRow($this->rows, 'Fixture Table Oil');
    $forgotten = productRow($this->rows, 'Fixture Fryer Oil');

    expect($declined['flags'])->toContain('channel_not_offered')
        ->and($declined['packs'])->toHaveCount(1)
        ->and($this->findings->where('source_ref', 'Fixture Table Oil')->where('code', 'b2c_price_missing'))->toBeEmpty()
        ->and($forgotten['flags'])->toContain('price_missing')
        ->and($this->findings->firstWhere('code', 'b2c_price_missing')['source_ref'])->toBe('Fixture Fryer Oil');
});

it('reports a missing business price the same way it reports a missing consumer one', function (): void {
    $parsed = ProductListParser::parse(<<<'MARKDOWN'
        Sheet1

        | Product | Kind | Category | Purchasing Unit | Usage Unit | B to B Weight | B to B Price US$ | B to C Weight | B to C Price US$ | Comments |
        | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
        | Fixture Silent Item | Production | Sauce | kg | kg | 1 kg |  | Not applicable |  |  |
        MARKDOWN);

    expect(collect($parsed['findings'])->pluck('code')->all())->toContain('b2b_price_missing')
        ->and($parsed['rows'][0]['flags'])->toContain('price_missing');
});

/*
|--------------------------------------------------------------------------
| Assortments, typos and units
|--------------------------------------------------------------------------
*/

it('expands an assorted row into its members and strips the punctuation the source trails', function (): void {
    expect(productRow($this->rows, 'Cucumber, Tomato, Onion, carrot…....( All Kinds)'))
        ->toMatchArray([
            'is_assorted' => true,
            'member_designations' => ['Cucumber', 'Tomato', 'Onion', 'carrot'],
        ]);

    // "Coriander…." is an ellipsis followed by a full stop. Both come off, or
    // the member never matches an ingredient.
    expect(productRow($this->rows, 'Lettuce, Parsley, Coriander…. (all Kinds)'))
        ->toMatchArray([
            'is_assorted' => true,
            'member_designations' => ['Lettuce', 'Parsley', 'Coriander'],
        ]);
});

it('leaves an ordinary product unexpanded', function (): void {
    expect(productRow($this->rows, 'Demo Dip Sauce'))
        ->toMatchArray(['is_assorted' => false, 'member_designations' => []]);
});

it('records each known misspelling as evidence rather than correcting it', function (): void {
    $typos = $this->findings->where('code', 'source_typo');

    expect($typos->pluck('source_ref')->all())->toBe([
        'Fixture Table Oil',
        'Fixture Cheese Block',
        'Fixture Cream Pot',
        'Pesto Saue',
        'Americain Fixture Patty',
    ])->and($typos->firstWhere('source_ref', 'Pesto Saue')['detail'])->toContain('in the product name');
});

it('reports a purchasing unit and a usage unit that measure different things', function (): void {
    $mismatches = $this->findings->where('code', 'purchasing_usage_unit_mismatch');

    expect($mismatches->pluck('source_ref')->all())->toBe([
        'Fixture Table Oil',
        'Fixture Fryer Oil',
        'Fixture Pickle Bag',
        'Fixture Relish Can',
        'Fixture Bun',
    ])->and($mismatches->firstWhere('source_ref', 'Fixture Table Oil')['detail'])->toContain('"3.78 L"');
});

it('does not call a spelling variant a dimension mismatch', function (): void {
    // kg against k, and kg against Kg, are one unit written two ways.
    $refs = $this->findings->where('code', 'purchasing_usage_unit_mismatch')->pluck('source_ref')->all();

    expect($refs)->not->toContain('Fixture Crumb Ball')
        ->and($refs)->not->toContain('Fixture Trial Item');
});

it('fires every finding code the fixture product list is built to provoke', function (): void {
    expect($this->findings->pluck('code')->unique()->sort()->values()->all())->toBe([
        'b2c_price_missing',
        'category_unmapped',
        'dual_pack_single_price',
        'kind_unmapped',
        'price_cell_is_pack_text',
        'price_sub_cent_rounded',
        'purchasing_usage_unit_mismatch',
        'source_typo',
    ]);
});
