<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientCostEvent;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\ReceiptPriceCompletionService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Receiving is never lost to a currency (SUP5) — §3.6
|--------------------------------------------------------------------------
|
| §3.6: "If that currency cannot be blended into the ingredient's existing
| valuation currency, physical receiving must not be lost: post the stock and
| receipt, mark the line `valuation_pending_fx`, and flag COGS/valuation as
| incomplete. Do not invent an exchange rate or add unlike currencies."
|
| Four things have to be simultaneously true for that to mean anything, and all
| four are asserted here:
|
| 1. the stock rose — the goods are physically on the shelf and pretending
|    otherwise would be the worst outcome of the three available;
| 2. the receipt and its line were saved, with the supplier's price **exactly as
|    written** — the raw price is never adjusted, ever;
| 3. no blend happened and no cost event was written — no rate was invented;
| 4. the receipt is visibly not complete, so a report cannot quietly present a
|    period as reconciled.
|
| The fifth claim is about the seam: `IngredientCostService::recordPurchase`
| still throws. Its invariant did not soften; what changed is that the receiving
| flow now knows what to do when it is refused. `IngredientCostServiceTest` still
| asserts the throw, deliberately.
|
*/

/**
 * A kitchen whose flour ingredient already holds its cost in USD, and one shelf
 * backed by it.
 */
function fxWorld(string $email): object
{
    $tenant = PricingWorld::kitchen($email, PricingWorld::FULL_PERMISSIONS);
    $organisation = $tenant->organisation;
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'country_code' => $organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation((string) $tenant->user->getKey(), (string) $organisation->getKey());

    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    $item = StockItem::query()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'FLR-1',
        'name_en' => 'Flour',
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    // The first purchase establishes the valuation currency.
    app(GoodsReceiptService::class)->post(
        (string) $organisation->getKey(),
        (string) $branch->getKey(),
        null,
        'DN-USD',
        null,
        [['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']],
    );

    app(TenantContext::class)->clear();

    return (object) [
        'tenant' => $tenant,
        'organisationId' => (string) $organisation->getKey(),
        'branch' => $branch,
        'branchId' => (string) $branch->getKey(),
        'itemId' => (string) $item->getKey(),
        'kgId' => (string) $kg->getKey(),
        'headers' => PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()],
    ];
}

/**
 * @param  list<array<string, mixed>>  $lines
 */
function fxPost(object $world, array $lines, string $documentRef): GoodsReceipt
{
    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);

    try {
        return app(GoodsReceiptService::class)->post(
            $world->organisationId,
            $world->branchId,
            null,
            $documentRef,
            null,
            $lines,
        );
    } finally {
        app(TenantContext::class)->clear();
    }
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

it('posts the stock and keeps the price when the blend hits a currency wall', function (): void {
    $world = fxWorld('fx-post@kitchen.test');

    $averageBefore = (string) IngredientStockCost::withoutTenancy()->sole()->moving_average_cost_amount;
    $eventsBefore = IngredientCostEvent::withoutTenancy()->count();

    $receipt = fxPost($world, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '5',
        'unit_id' => $world->kgId,
        'unit_price_amount' => '3.00',
        'cost_currency_code' => 'EUR',
    ]], 'DN-EUR');

    // 1. the goods are on the shelf.
    expect(StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->value('quantity'))->toBe('15.0000')
        ->and(StockMovement::withoutTenancy()->count())->toBe(2);

    // 2. the receipt and the supplier's price survived, unadjusted.
    $line = GoodsReceiptLine::query()->where('goods_receipt_id', $receipt->getKey())->sole();
    expect((string) $line->unit_price_amount)->toBe('3.000000')
        ->and((string) $line->line_total_amount)->toBe('15.000000')
        ->and($line->cost_currency_code)->toBe('EUR')
        ->and($line->valuation_pending_fx)->toBeTrue()
        // Not costed: there is still something outstanding on this line.
        ->and($line->costed_at)->toBeNull();

    // 3. no rate was invented — the average and its ledger are untouched.
    expect((string) IngredientStockCost::withoutTenancy()->sole()->moving_average_cost_amount)->toBe($averageBefore)
        ->and(IngredientStockCost::withoutTenancy()->sole()->currency_code)->toBe('USD')
        ->and(IngredientCostEvent::withoutTenancy()->count())->toBe($eventsBefore);

    // 4. the receipt is visibly unfinished.
    expect($receipt->cost_status)->toBe('unpriced');
});

it('shows the pending line in the queue with a count that distinguishes it from a missing price', function (): void {
    $world = fxWorld('fx-queue@kitchen.test');

    $receipt = fxPost($world, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '5',
        'unit_id' => $world->kgId,
        'unit_price_amount' => '3.00',
        'cost_currency_code' => 'EUR',
    ]], 'DN-EUR');

    $this->actingAs($world->tenant->user);

    // "Type these prices in" and "the prices are here and something else is
    // blocking" are different jobs, and the queue has to tell them apart.
    $this->getJson('/api/v1/catalogue/procurement/unpriced-receipts', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.unpriced_receipts.0.id', (string) $receipt->getKey())
        ->assertJsonPath('data.unpriced_receipts.0.cost_status', 'unpriced')
        ->assertJsonPath('data.unpriced_receipts.0.unpriced_line_count', 1)
        ->assertJsonPath('data.unpriced_receipts.0.valuation_pending_count', 1);

    $this->getJson("/api/v1/catalogue/procurement/goods-receipts/{$receipt->getKey()}", $world->headers)
        ->assertOk()
        ->assertJsonPath('data.goods_receipt.lines.0.valuation_pending_fx', true)
        ->assertJsonPath('data.goods_receipt.lines.0.costed_at', null)
        // The supplier's price is still on the record for a cost holder.
        ->assertJsonPath('data.goods_receipt.lines.0.unit_price_amount', '3.000000');
});

it('refuses to re-price a line that is waiting on an exchange-rate decision', function (): void {
    $world = fxWorld('fx-completion@kitchen.test');

    $receipt = fxPost($world, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '5',
        'unit_id' => $world->kgId,
        'unit_price_amount' => '3.00',
        'cost_currency_code' => 'EUR',
    ]], 'DN-EUR');

    $lineId = (string) GoodsReceiptLine::query()->where('goods_receipt_id', $receipt->getKey())->sole()->getKey();

    $complete = function () use ($world, $receipt, $lineId): void {
        app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);

        try {
            app(ReceiptPriceCompletionService::class)->complete(
                GoodsReceipt::query()->findOrFail($receipt->getKey()),
                [['goods_receipt_line_id' => $lineId, 'unit_price_amount' => '3.00', 'cost_currency_code' => 'USD']],
            );
        } finally {
            app(TenantContext::class)->clear();
        }
    };

    // Its price is already recorded; what is outstanding is a valuation
    // decision, which §3.6 assigns to a later accounting phase. Offering to
    // re-price it here would invite somebody to rewrite a real invoice figure in
    // order to dodge a currency wall.
    expect($complete)->toThrow(ApiException::class, "This line's price is already recorded");

    expect((string) GoodsReceiptLine::query()->whereKey($lineId)->sole()->unit_price_amount)->toBe('3.000000');
});

it('flags a line priced at completion time in a currency the valuation cannot take', function (): void {
    // The mirror case: the delivery arrived unpriced, and the invoice that
    // eventually turned up is in the wrong currency. The invoice is not lost
    // either.
    $world = fxWorld('fx-late-invoice@kitchen.test');

    $receipt = fxPost($world, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '5',
        'unit_id' => $world->kgId,
    ]], 'DN-LATE');

    expect($receipt->cost_status)->toBe('unpriced');

    $lineId = (string) GoodsReceiptLine::query()->where('goods_receipt_id', $receipt->getKey())->sole()->getKey();

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);
    $completed = app(ReceiptPriceCompletionService::class)->complete(
        GoodsReceipt::query()->findOrFail($receipt->getKey()),
        [['goods_receipt_line_id' => $lineId, 'unit_price_amount' => '3.00', 'cost_currency_code' => 'EUR']],
    );
    app(TenantContext::class)->clear();

    $line = GoodsReceiptLine::query()->whereKey($lineId)->sole();

    expect($line->valuation_pending_fx)->toBeTrue()
        ->and($line->costed_at)->toBeNull()
        ->and((string) $line->unit_price_amount)->toBe('3.000000')
        ->and($completed->cost_status)->toBe('unpriced')
        // Still no second movement, and still no invented rate.
        ->and(StockMovement::withoutTenancy()->count())->toBe(2)
        ->and(IngredientStockCost::withoutTenancy()->sole()->currency_code)->toBe('USD');
});

it('leaves the monthly cost report able to see the period as incomplete', function (): void {
    $world = fxWorld('fx-report@kitchen.test');

    fxPost($world, [[
        'stock_item_id' => $world->itemId,
        'quantity' => '5',
        'unit_id' => $world->kgId,
        'unit_price_amount' => '3.00',
        'cost_currency_code' => 'EUR',
    ]], 'DN-EUR');

    // Slice 6 builds the week/month summary over exactly this: a receipt that is
    // not `complete` is what makes a period **Incomplete** rather than quietly
    // short. The state is queryable today, per §3.4's completeness filter.
    expect(GoodsReceipt::withoutTenancy()->where('cost_status', '<>', 'complete')->count())->toBe(1)
        ->and(GoodsReceiptLine::query()->where('valuation_pending_fx', true)->count())->toBe(1);
});
