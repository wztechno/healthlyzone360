<?php

declare(strict_types=1);

use Healthy360\Kitchens\Import\Parsers\CustomerDataParser;
use Healthy360\Kitchens\Tests\Import\WorkbookFixture;

/*
|--------------------------------------------------------------------------
| Two facts out of a workbook that is mostly not this platform's business
|--------------------------------------------------------------------------
|
| The trap this file guards is a real one, found by running the parser against
| the source: the phrase "Delivery Window" appears twice, once as the heading
| over the three values and once, several sheets earlier, in the source-list
| column of a field specification. Matching the phrase alone finds the
| specification first and walks down the wrong column, returning a dozen
| field labels that are not delivery windows and look exactly like delivery
| windows to everything downstream. The fixture reproduces both, in that
| order.
|
*/

beforeEach(function (): void {
    $this->parsed = CustomerDataParser::parse(WorkbookFixture::read(WorkbookFixture::CUSTOMERS));
});

it('finds the delivery-window dropdown and not the field specification that names it', function (): void {
    expect($this->parsed['delivery_windows'])->toBe([
        ['code' => 'morning', 'name' => 'Morning'],
        ['code' => 'afternoon', 'name' => 'Afternoon'],
        ['code' => 'evening', 'name' => 'Evening'],
    ]);
});

it('stops at the blank that ends the column instead of reading the next dropdown group', function (): void {
    $names = array_column($this->parsed['delivery_windows'], 'name');

    expect($names)->not->toContain('Volume Band')
        ->and($names)->not->toContain('Payment Method')
        ->and($names)->not->toContain('G. Payment');
});

it('reads the zone count out of the areas heading', function (): void {
    expect($this->parsed['delivery_area_count'])->toBe(12);
});

it('returns no count rather than a wrong one when the heading is absent', function (): void {
    $parsed = CustomerDataParser::parse("Sheet1:Nothing here\n\n| a | b |\n| --- | --- |\n| c | d |\n");

    expect($parsed['delivery_area_count'])->toBeNull()
        ->and($parsed['delivery_windows'])->toBe([]);
});

it('says the source names the windows and never times them', function (): void {
    $findings = collect($this->parsed['findings']);

    expect($findings->pluck('code')->all())->toBe([
        'delivery_window_times_absent',
        'delivery_areas_platform_seeded',
    ])
        ->and($findings->firstWhere('code', 'delivery_window_times_absent')['detail'])
        ->toContain('states no start or end time')
        ->and($findings->firstWhere('code', 'delivery_areas_platform_seeded')['detail'])
        ->toContain('already platform reference data');
});
