<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientCostEvent;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Exceptions\MixedIngredientCostCurrency;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\IngredientCostService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| IngredientCostService — the weighted moving-average blend (INV1.1)
|--------------------------------------------------------------------------
|
| The one place this feature turns purchases into a per-ingredient cost. The
| arithmetic is money, so it is bcmath on decimal strings and it is tested: the
| blend itself, the conversion of a purchase unit into the ingredient's own
| unit, the refusal to blend a second currency or cross a dimension, and the
| honest no-ingredient-link case where a receipt raises stock but costs nothing.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('cost@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'country_code' => $this->organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation((string) $this->tenant->user->getKey(), (string) $this->organisation->getKey());

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->g = MeasurementUnit::query()->where('code', 'g')->sole();
    $this->litre = MeasurementUnit::query()->where('code', 'l')->sole();

    // An ingredient whose cost the average is expressed per — kilograms.
    $this->ingredient = Ingredient::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'default_unit_id' => (string) $this->kg->getKey(),
    ]);

    $this->service = app(IngredientCostService::class);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

it('sets the average to the unit cost on the first purchase', function (): void {
    $cost = $this->service->recordPurchase(
        (string) $this->organisation->getKey(),
        $this->ingredient,
        '10',
        $this->kg,
        '2.00',
        'USD',
    );

    expect((string) $cost->moving_average_cost_amount)->toBe('2.000000')
        ->and((string) $cost->quantity_on_hand)->toBe('10.000000')
        ->and((string) $cost->last_purchase_cost_amount)->toBe('2.000000')
        ->and($cost->currency_code)->toBe('USD');

    $event = IngredientCostEvent::withoutTenancy()->sole();
    expect((string) $event->quantity)->toBe('10.000000')
        ->and((string) $event->unit_cost_amount)->toBe('2.000000')
        ->and((string) $event->line_total_amount)->toBe('20.000000')
        ->and((string) $event->resulting_average_amount)->toBe('2.000000');
});

it('blends a second purchase measured in a different unit into one weighted average', function (): void {
    // 10 kg at 2.00/kg, then 5000 g at 0.0025/g (= 2.50/kg). The gram purchase
    // converts to 5 kg, so the average is (10·2 + 5·2.50) ÷ 15 = 2.166667.
    $this->service->recordPurchase((string) $this->organisation->getKey(), $this->ingredient, '10', $this->kg, '2.00', 'USD');
    $cost = $this->service->recordPurchase((string) $this->organisation->getKey(), $this->ingredient, '5000', $this->g, '0.0025', 'USD');

    expect((string) $cost->quantity_on_hand)->toBe('15.000000')
        ->and((string) $cost->moving_average_cost_amount)->toBe('2.166667')
        ->and((string) $cost->last_purchase_cost_amount)->toBe('2.500000');

    $latest = IngredientCostEvent::withoutTenancy()->orderByDesc('created_at')->orderByDesc('id')->first();
    expect((string) $latest->quantity)->toBe('5.000000')
        ->and((string) $latest->unit_cost_amount)->toBe('2.500000')
        ->and((string) $latest->line_total_amount)->toBe('12.500000')
        ->and((string) $latest->resulting_average_amount)->toBe('2.166667');
});

it('refuses to blend a second currency into an existing average', function (): void {
    $this->service->recordPurchase((string) $this->organisation->getKey(), $this->ingredient, '10', $this->kg, '2.00', 'USD');

    $blendEuro = fn () => $this->service->recordPurchase(
        (string) $this->organisation->getKey(),
        $this->ingredient,
        '5',
        $this->kg,
        '3.00',
        'EUR',
    );

    expect($blendEuro)->toThrow(MixedIngredientCostCurrency::class);

    // The refusal left the average and its ledger untouched.
    expect((string) IngredientStockCost::withoutTenancy()->sole()->moving_average_cost_amount)->toBe('2.000000')
        ->and(IngredientCostEvent::withoutTenancy()->count())->toBe(1);
});

it('refuses to value a purchase whose unit cannot convert to the ingredient unit', function (): void {
    // The ingredient is measured in kilograms (mass); a litre (volume) has no
    // ratio to it, so the purchase is refused rather than valued at a made-up
    // density.
    $blendVolume = fn () => $this->service->recordPurchase(
        (string) $this->organisation->getKey(),
        $this->ingredient,
        '4',
        $this->litre,
        '3.00',
        'USD',
    );

    expect($blendVolume)->toThrow(UnitConversionUnsupported::class);
    expect(IngredientStockCost::withoutTenancy()->count())->toBe(0);
});

it('raises stock but records no cost for a receipt line whose stock item has no ingredient', function (): void {
    // A packaging SKU: real stock, no ingredient behind it, so a price on the
    // line moves the shelf and nothing else — there is no average it could join.
    $packaging = StockItem::query()->create([
        'organisation_id' => $this->organisation->getKey(),
        'code' => 'PKG-1',
        'name_en' => 'Takeaway boxes',
        'unit_code' => 'piece',
        'unit_id' => (string) MeasurementUnit::query()->where('code', 'piece')->value('id'),
        'ingredient_id' => null,
    ]);

    app(GoodsReceiptService::class)->post(
        (string) $this->organisation->getKey(),
        (string) $this->branch->getKey(),
        null,
        null,
        null,
        [[
            'stock_item_id' => (string) $packaging->getKey(),
            'quantity' => '100',
            'unit_id' => (string) MeasurementUnit::query()->where('code', 'piece')->value('id'),
            'unit_price_amount' => '0.35',
            'cost_currency_code' => 'USD',
        ]],
    );

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $packaging->getKey())->value('quantity'))->toBe('100.0000')
        ->and(IngredientCostEvent::withoutTenancy()->count())->toBe(0)
        ->and(IngredientStockCost::withoutTenancy()->count())->toBe(0);
});

it('converts a purchase into the stock unit and blends its cost through the receipt service', function (): void {
    // A stock item measured in kg, backed by the kg ingredient. Buying 2000 g
    // raises the shelf by 2 kg and sets the ingredient average to 2.50/kg.
    $item = StockItem::query()->create([
        'organisation_id' => $this->organisation->getKey(),
        'code' => 'FLR-1',
        'name_en' => 'Flour',
        'unit_code' => 'kg',
        'unit_id' => (string) $this->kg->getKey(),
        'ingredient_id' => (string) $this->ingredient->getKey(),
    ]);

    app(GoodsReceiptService::class)->post(
        (string) $this->organisation->getKey(),
        (string) $this->branch->getKey(),
        null,
        'DN-1001',
        null,
        [[
            'stock_item_id' => (string) $item->getKey(),
            'quantity' => '2000',
            'unit_id' => (string) $this->g->getKey(),
            'unit_price_amount' => '0.0025',
            'cost_currency_code' => 'USD',
        ]],
    );

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $item->getKey())->value('quantity'))->toBe('2.0000');

    $cost = IngredientStockCost::withoutTenancy()->where('ingredient_id', $this->ingredient->getKey())->sole();
    expect((string) $cost->quantity_on_hand)->toBe('2.000000')
        ->and((string) $cost->moving_average_cost_amount)->toBe('2.500000');
});
