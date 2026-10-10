<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Services\InventoryValuationService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| What the shelves are worth (PROD1)
|--------------------------------------------------------------------------
|
| Three rules, and all three are about refusing to round a hole down to zero:
| never one total across currencies, never a value for stock nothing can price,
| and never a figure that reads complete when it is not.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('valuation@kitchen.test');
    $this->orgId = (string) $this->tenant->organisation->getKey();

    app(TenantContext::class)->setOrganisation((string) $this->tenant->user->getKey(), $this->orgId);

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->valuation = app(InventoryValuationService::class);

    $this->hold = function (string $quantity, ?string $average, ?string $currency = 'USD'): void {
        $ingredient = Ingredient::factory()->create([
            'organisation_id' => $this->orgId,
            'default_unit_id' => (string) $this->kg->getKey(),
        ]);

        IngredientStockCost::query()->updateOrCreate(
            ['organisation_id' => $this->orgId, 'ingredient_id' => (string) $ingredient->getKey()],
            [
                'unit_id' => (string) $this->kg->getKey(),
                'quantity_on_hand' => $quantity,
                'moving_average_cost_amount' => $average,
                'currency_code' => $average === null ? null : $currency,
            ],
        );
    };
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

it('values the shelves at quantity times the moving average', function (): void {
    ($this->hold)('10.000000', '2.500000');
    ($this->hold)('4.000000', '1.250000');

    expect($this->valuation->byCurrency($this->orgId))->toBe([
        ['currency_code' => 'USD', 'value_amount' => '30.000000', 'valued_item_count' => 2],
    ]);
});

it('never adds two currencies into one total', function (): void {
    ($this->hold)('10.000000', '2.000000', 'USD');
    ($this->hold)('10.000000', '3.000000', 'EUR');

    // Two valuations, not one. This system has no exchange-rate source and
    // inventing one to make a tidier number would be the worst figure on the
    // page.
    expect($this->valuation->byCurrency($this->orgId))->toBe([
        ['currency_code' => 'EUR', 'value_amount' => '30.000000', 'valued_item_count' => 1],
        ['currency_code' => 'USD', 'value_amount' => '20.000000', 'valued_item_count' => 1],
    ]);
});

it('counts stock it cannot price rather than valuing it at zero', function (): void {
    ($this->hold)('10.000000', '2.000000');
    ($this->hold)('7.000000', null);

    // Twenty is real and **incomplete**. Valuing the unpriced shelf at zero would
    // make the same number read complete, which is the worse of the two ways to
    // be wrong.
    expect($this->valuation->byCurrency($this->orgId))->toBe([
        ['currency_code' => 'USD', 'value_amount' => '20.000000', 'valued_item_count' => 1],
    ])->and($this->valuation->unvaluedItemCount($this->orgId))->toBe(1);
});

it('ignores an empty shelf on either side of the question', function (): void {
    ($this->hold)('0.000000', '2.000000');
    ($this->hold)('0.000000', null);

    // Nothing is held, so there is nothing to value and nothing to flag. An
    // ingredient with no stock and no price is not a gap in the valuation.
    expect($this->valuation->byCurrency($this->orgId))->toBe([])
        ->and($this->valuation->unvaluedItemCount($this->orgId))->toBe(0);
});
