<?php

declare(strict_types=1);

use Healthy360\Support\Identifiers\Gs1;

/*
|--------------------------------------------------------------------------
| GS1 identifiers, as scanners and packs produce them
|--------------------------------------------------------------------------
|
| Pinned against vectors worked by hand. A scan read wrongly books a delivery
| against the wrong product or the wrong lot, so the parser is tested hardest on
| what it must refuse, and on the one thing it must never do: split a field
| whose end it cannot prove.
|
*/

it('computes the GS1 mod-10 check digit', function (string $digits, int $expected): void {
    expect(Gs1::checkDigit($digits))->toBe($expected);
})->with([
    'the GS1 worked example' => ['400638133393', 1],
    'the first kitchen code' => ['040000000001', 5],
    'a sum already a multiple of ten' => ['000000000', 0],
]);

it('normalises every GTIN length to fourteen digits', function (string $scan, ?string $symbology, string $gtin): void {
    $read = Gs1::parse($scan, $symbology);

    expect($read?->gtin)->toBe($gtin)
        ->and($read?->boundaryVerified)->toBeTrue();
})->with([
    'EAN-8' => ['96385074', null, '00000096385074'],
    'UPC-A' => ['036000291452', null, '00036000291452'],
    'EAN-13' => ['4006381333931', null, '04006381333931'],
    'GTIN-14 case code' => ['10012345678902', null, '10012345678902'],
    'UPC-E from the camera, last digit 1' => ['04252614', 'upc_e', '00042100005264'],
    'UPC-E from the camera, last digit 6' => ['01234565', 'upc_e', '00012345000065'],
    'an EAN-13 with its AIM prefix' => [']E04006381333931', null, '04006381333931'],
    'a scan with a trailing newline' => ["4006381333931\r\n", null, '04006381333931'],
]);

it('reads UPC-E digits as EAN-8 when nobody said UPC-E', function (): void {
    // 04252614 is not a valid EAN-8, so without the symbology it is refused
    // rather than expanded on a guess.
    expect(Gs1::parse('04252614'))->toBeNull()
        ->and(Gs1::refusal('04252614'))->toBe('check_digit')
        // UPC-E has number systems 0 and 1 only.
        ->and(Gs1::refusal('24252614', 'upc_e'))->toBe('unreadable');
});

it('reads element strings whose boundaries are marked', function (string $scan): void {
    $read = Gs1::parse($scan);

    expect($read?->gtin)->toBe('05012345678900')
        ->and($read?->lot())->toBe('ABC')
        ->and($read?->expiresOn()?->toDateString())->toBe('2026-11-30')
        ->and($read?->boundaryVerified)->toBeTrue();
})->with([
    'a group separator after the lot' => ['0105012345678900'."10ABC\x1D17261130"],
    'the printed line' => ['(01)05012345678900(17)261130(10)ABC'],
    'a GS1-128 scan with its AIM prefix and a separator' => ["]C1010501234567890010ABC\x1D17261130"],
    'a DataMatrix scan with its AIM prefix and a separator' => ["]d2010501234567890010ABC\x1D17261130"],
    'a Digital Link' => ['https://id.gs1.org/01/05012345678900/10/ABC?17=261130'],
    'a Digital Link with a 13-digit GTIN and a link type' => ['https://example.com/x/01/5012345678900/10/ABC?linkType=all&17=261130'],
]);

it('takes a separator-free variable field literally and never splits it', function (): void {
    $read = Gs1::parse('0105012345678900'.'10ABC17261130');

    expect($read?->gtin)->toBe('05012345678900')
        ->and($read?->lot())->toBe('ABC17261130')
        ->and($read?->elements)->not->toHaveKey('17')
        ->and($read?->boundaryVerified)->toBeFalse();
});

it('reads fixed fields ahead of a final lot, but cannot prove the lot ends there', function (): void {
    $read = Gs1::parse('0105012345678900'.'15261130'.'17261231'.'10ABC');

    expect($read?->lot())->toBe('ABC')
        ->and($read?->bestBeforeOn()?->toDateString())->toBe('2026-11-30')
        ->and($read?->expiresOn()?->toDateString())->toBe('2026-12-31')
        ->and($read?->boundaryVerified)->toBeFalse();
});

it('reads a GS1 symbol as an element string even when its digits look like a GTIN', function (string $scan, ?string $symbology): void {
    $read = Gs1::parse($scan, $symbology);

    expect($read?->gtin)->toBeNull()
        ->and($read?->bestBeforeOn()?->toDateString())->toBe('2026-11-30');
})->with([
    'a GS1-128 symbol with its AIM id' => [']C115261130', null],
    'a leading FNC1 sent as a separator' => ["\x1D15261130", null],
    'a Code 128 read by the camera' => ['15261130', 'code128'],
]);

it('falls back to a bare GTIN when a camera Code 128 is not an element string', function (): void {
    expect(Gs1::parse('4006381333931', 'code128')?->gtin)->toBe('04006381333931');
});

it('reports a scan with no GTIN in it', function (): void {
    $read = Gs1::parse('(11)260925(10)2609250077');

    expect($read?->gtin)->toBeNull()
        ->and($read?->lot())->toBe('2609250077');
});

it('refuses what it cannot read exactly', function (string $scan, string $reason): void {
    expect(Gs1::parse($scan))->toBeNull()
        ->and(Gs1::refusal($scan))->toBe($reason);
})->with([
    'an EAN-13 with one digit wrong' => ['4006381333932', 'check_digit'],
    'a (01) whose check digit fails' => ['(01)05012345678901', 'check_digit'],
    'a lot over twenty characters' => ['(10)'.str_repeat('A', 21), 'unreadable'],
    'a raw lot over twenty characters' => ['0105012345678900'.'10'.str_repeat('A', 21), 'unreadable'],
    'month thirteen' => ['(17)261330', 'unreadable'],
    'the thirtieth of February' => ['(17)260230', 'unreadable'],
    'an AI the parser does not know' => ['(240)ABC', 'unreadable'],
    'trailing data after the printed line' => ['(01)05012345678900x', 'unreadable'],
    'trailing data after a raw GTIN' => ['0105012345678900Z', 'unreadable'],
    'a date cut short' => ['(17)2611', 'unreadable'],
    'a lot character GS1 does not encode' => ['(10)AB#C', 'unreadable'],
    'the same AI twice' => ['(10)ABC(10)DEF', 'unreadable'],
    'an empty lot' => ["10\x1D17261130", 'unreadable'],
    'a Digital Link with no GTIN' => ['https://example.com/products/42', 'unreadable'],
    'garbage' => ['hello world', 'unreadable'],
    'nothing' => ['', 'unreadable'],
]);

it('reads a day of 00 as the last day of the month, and YY as 20YY', function (string $yymmdd, ?string $expected): void {
    expect(Gs1::date($yymmdd)?->toDateString())->toBe($expected);
})->with([
    ['261130', '2026-11-30'],
    ['260200', '2026-02-28'],
    ['280200', '2028-02-29'],
    ['261200', '2026-12-31'],
    ['260229', null],
    ['260015', null],
]);

it('knows the codes that change from pack to pack and the kitchen range', function (): void {
    expect(Gs1::isVariableMeasure('00212345678900'))->toBeTrue()   // GTIN-13 prefix 02
        ->and(Gs1::isVariableMeasure('02912345678908'))->toBeTrue() // GTIN-13 prefix 29
        ->and(Gs1::isVariableMeasure('91234567890128'))->toBeTrue() // GTIN-14 indicator 9
        ->and(Gs1::isVariableMeasure('04006381333931'))->toBeFalse()
        ->and(Gs1::isRestrictedCirculation('00400000000015'))->toBeTrue()
        ->and(Gs1::isRestrictedCirculation('04006381333931'))->toBeFalse();
});
