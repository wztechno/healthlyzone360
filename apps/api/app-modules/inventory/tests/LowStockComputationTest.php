<?php

declare(strict_types=1);

use Healthy360\Inventory\Services\InventoryService;

/*
|--------------------------------------------------------------------------
| InventoryService::isLowStock — the low-stock boundary (INV1.3)
|--------------------------------------------------------------------------
|
| Low-stock is computed on read, never stored. The whole contract is three
| rules: a null threshold is never low; quantity equal to the threshold is
| already low (that is the moment to reorder); quantity above it is not. The
| comparison is bccomp on decimal strings, so the equality boundary is exact
| rather than a float near-miss.
|
*/

it('is never low when no threshold is set, whatever the quantity', function (): void {
    expect(InventoryService::isLowStock(null, '0'))->toBeFalse()
        ->and(InventoryService::isLowStock(null, '0.0001'))->toBeFalse()
        ->and(InventoryService::isLowStock(null, '9999'))->toBeFalse();
});

it('is low at exactly the threshold — the inclusive boundary', function (): void {
    expect(InventoryService::isLowStock('15', '15'))->toBeTrue()
        ->and(InventoryService::isLowStock('15.0000', '15'))->toBeTrue()
        ->and(InventoryService::isLowStock('0.5000', '0.5'))->toBeTrue();
});

it('is low below the threshold and not low above it', function (): void {
    expect(InventoryService::isLowStock('15', '9.75'))->toBeTrue()
        ->and(InventoryService::isLowStock('15', '14.9999'))->toBeTrue()
        ->and(InventoryService::isLowStock('15', '15.0001'))->toBeFalse()
        ->and(InventoryService::isLowStock('15', '42.5'))->toBeFalse();
});

it('treats a zero threshold as a real threshold — only an empty count is low', function (): void {
    // A threshold of zero is set, so it is not "never low"; the item is low only
    // once it is fully depleted, which the inclusive boundary catches at zero.
    expect(InventoryService::isLowStock('0', '0'))->toBeTrue()
        ->and(InventoryService::isLowStock('0', '0.0001'))->toBeFalse();
});
