<?php

declare(strict_types=1);

use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Healthy360\Support\Api\ErrorCode;

/*
|--------------------------------------------------------------------------
| UnitConversionService — the arithmetic the deduction path will divide by
|--------------------------------------------------------------------------
|
| Targeted at the three things that must not be wrong: within-dimension
| correctness, bcmath precision (never floats), and the loud refusal of any
| conversion the seeded factors do not support.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->service = new UnitConversionService;
});

/**
 * The seeded unit for a code — the real factors, not a factory's invention.
 */
function conversionUnit(string $code): MeasurementUnit
{
    return MeasurementUnit::query()->where('code', $code)->sole();
}

it('converts within the mass dimension using the seeded factors', function (): void {
    expect($this->service->convert('1', conversionUnit('kg'), conversionUnit('g')))->toBe('1000.000000')
        ->and($this->service->convert('2500', conversionUnit('g'), conversionUnit('kg')))->toBe('2.500000')
        ->and($this->service->convert('1', conversionUnit('mg'), conversionUnit('g')))->toBe('0.001000')
        ->and($this->service->convert('1000', conversionUnit('mg'), conversionUnit('g')))->toBe('1.000000');
});

it('converts within the volume dimension, including the approximate culinary factors', function (): void {
    expect($this->service->convert('1', conversionUnit('l'), conversionUnit('ml')))->toBe('1000.000000')
        ->and($this->service->convert('15', conversionUnit('ml'), conversionUnit('tbsp')))->toBe('1.000000')
        ->and($this->service->convert('1', conversionUnit('cup'), conversionUnit('ml')))->toBe('240.000000');
});

it('rounds a repeating conversion half away from zero to six places, never as a float', function (): void {
    // 1 tsp ÷ 240 ml/cup = 0.0208333…; the sixth place is what a float would
    // start losing, and it is fixed here to prove the bcmath path.
    expect($this->service->convert('1', conversionUnit('tsp'), conversionUnit('cup')))->toBe('0.020833');
});

it('treats a unit converted to itself as the identity, in any dimension', function (): void {
    expect($this->service->convert('7.5', conversionUnit('kg'), conversionUnit('kg')))->toBe('7.500000')
        // Identity is legal even where the dimension itself does not convert.
        ->and($this->service->convert('3', conversionUnit('piece'), conversionUnit('piece')))->toBe('3.000000');
});

it('refuses a cross-dimension conversion loudly', function (): void {
    $this->service->convert('1', conversionUnit('kg'), conversionUnit('l'));
})->throws(UnitConversionUnsupported::class);

it('names the cross-dimension refusal with a stable reason and error code', function (): void {
    try {
        $this->service->convert('1', conversionUnit('kg'), conversionUnit('l'));
        $this->fail('Expected a cross-dimension conversion to be refused.');
    } catch (UnitConversionUnsupported $e) {
        expect($e->errorCode)->toBe(ErrorCode::UnitConversionUnsupported)
            ->and($e->details['reason'])->toBe('cross_dimension')
            ->and($e->details['from_dimension'])->toBe('mass')
            ->and($e->details['to_dimension'])->toBe('volume');
    }
});

it('refuses conversion between two different units of a non-convertible dimension', function (string $from, string $to): void {
    try {
        $this->service->convert('1', conversionUnit($from), conversionUnit($to));
        $this->fail("Expected {$from} → {$to} to be refused.");
    } catch (UnitConversionUnsupported $e) {
        expect($e->details['reason'])->toBe('dimension_not_convertible');
    }
})->with([
    'length (cm → m) has no validated factors' => ['cm', 'm'],
    'energy (kcal → kJ) is a real conversion this slice has not validated' => ['kcal', 'kJ'],
    'package (bunch → can) is not a ratio at all' => ['bunch', 'can'],
]);
