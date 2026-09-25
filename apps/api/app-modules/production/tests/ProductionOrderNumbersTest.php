<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\Production\Services\ProductionOrderNumbers;

/*
|--------------------------------------------------------------------------
| The numbers on a batch's label (D-145 – D-147)
|--------------------------------------------------------------------------
|
| Pure functions, so pinned against vectors worked by hand rather than against
| what the code happens to return. A lot is read off a tray by a person and off
| a label by a scanner, and a slip in either direction opens the wrong batch —
| which is why the lookup is tested hardest on what it must *refuse*.
|
*/

it('computes the GS1 mod-10 check digit a GTIN carries', function (string $digits, int $expected): void {
    expect(ProductionOrderNumbers::checkDigit($digits))->toBe($expected);
})->with([
    // The GS1 worked example.
    'a twelve-digit GTIN body' => ['400638133393', 1],
    'the first lot of 25 Sep 2026' => ['260925001', 5],
    'a sum that is already a multiple of ten' => ['000000000', 0],
]);

it('builds a lot from the production day, the sequence and the check digit', function (int $sequence, string $expected): void {
    expect(ProductionOrderNumbers::lotFor(CarbonImmutable::parse('2026-09-25'), $sequence))->toBe($expected);
})->with([
    [1, '2609250015'],
    [2, '2609250022'],
    [7, '2609250077'],
]);

it('writes the GS1-128 element string with the lot last', function (): void {
    expect(ProductionOrderNumbers::barcode('2609250077', CarbonImmutable::parse('2026-09-30')))
        ->toBe('(11)260925(17)260930(10)2609250077')
        // No expiry, no (17) — never an empty date.
        ->and(ProductionOrderNumbers::barcode('2609250077', null))
        ->toBe('(11)260925(10)2609250077');
});

it('reduces whatever was scanned or typed to the one key it can mean', function (string $code, ?string $expected): void {
    expect(ProductionOrderNumbers::lookupKey($code))->toBe($expected);
})->with([
    'a keyboard-wedge scan with the symbology prefix' => [']C11126092517260930102609250077', '2609250077'],
    'the line printed under the bars' => ['(11)260925(17)260930(10)2609250077', '2609250077'],
    'a scan with a group separator before the lot' => ["1126092517260930\x1D102609250077", '2609250077'],
    'a scan without an expiry' => ['11260925102609250077', '2609250077'],
    'a bare lot' => ['2609250077', '2609250077'],
    'a lot typed as it is shown' => ['260925-007-7', '2609250077'],
    'a lot typed with spaces around it' => ['  260925 007 7 ', '2609250077'],
    'a lot with one digit wrong' => ['2609250074', null],
    'a printed line whose lot fails its check' => ['(11)260925(10)2609250074', null],
    'a work-order reference in lower case' => ['pb-abcd1234', 'PB-ABCD1234'],
    'a reference with a letter Crockford excludes' => ['PB-ABCD123I', null],
    'a GTIN and no lot' => ['(01)12345678901231', null],
    'an AI this kitchen never prints' => ['(21)ABC123(10)2609250077', null],
    'a date AI cut short' => ['(11)2609', null],
    'garbage' => ['hello world', null],
    'nothing at all' => ['', null],
]);
