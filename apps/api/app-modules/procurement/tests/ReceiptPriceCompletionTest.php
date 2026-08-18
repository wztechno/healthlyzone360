<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientCostEvent;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\ReceiptLineCosting;
use Healthy360\Procurement\Services\ReceiptPriceCompletionService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Completing prices on a receipt (SUP5) — §3.6
|--------------------------------------------------------------------------
|
| §3.6 in one sentence: "Completing costs calls the costing path only for lines
| whose `costed_at` is null and never creates a second stock movement." Both
| halves are pinned here, and the second one structurally as well as
| behaviourally — the whole guarantee rests on neither service being able to move
| stock, so the constructors are asserted rather than only the outcomes.
|
| The third claim is the one that is easy to get wrong: pricing a line twice must
| be a refusal a person can see, not a silent skip. Somebody who believed they
| had corrected a figure and had not is worse off than somebody who was told no.
|
*/

/**
 * A kitchen with one **unpriced** receipt of flour already posted into it.
 */
function completionWorld(string $email): object
{
    $tenant = PricingWorld::kitchen($email, PricingWorld::FULL_PERMISSIONS);
    $organisation = $tenant->organisation;
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'country_code' => $organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation((string) $tenant->user->getKey(), (string) $organisation->getKey());

    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $supplier = Supplier::query()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'SUP-1',
        'name_en' => 'Gulf Fresh',
        'currency_code' => 'USD',
    ]);

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

    // The delivery landed; the invoice did not.
    $receipt = app(GoodsReceiptService::class)->post(
        (string) $organisation->getKey(),
        (string) $branch->getKey(),
        (string) $supplier->getKey(),
        'DN-9001',
        null,
        [['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $kg->getKey()]],
    );

    app(TenantContext::class)->clear();

    return (object) [
        'tenant' => $tenant,
        'organisation' => $organisation,
        'organisationId' => (string) $organisation->getKey(),
        'branch' => $branch,
        'itemId' => (string) $item->getKey(),
        'kgId' => (string) $kg->getKey(),
        'receiptId' => (string) $receipt->getKey(),
        'headers' => PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()],
    ];
}

function completionLineId(object $world): string
{
    return (string) GoodsReceiptLine::query()->where('goods_receipt_id', $world->receiptId)->sole()->getKey();
}

/**
 * @param  list<array<string, mixed>>  $lines
 */
function completePrices(object $world, array $lines): GoodsReceipt
{
    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);

    try {
        $receipt = GoodsReceipt::query()->findOrFail($world->receiptId);

        return app(ReceiptPriceCompletionService::class)->complete($receipt, $lines);
    } finally {
        app(TenantContext::class)->clear();
    }
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

/* ── the structural guarantee ────────────────────────────────────────────── */

it('cannot move stock, because neither service can reach the inventory', function (): void {
    // §3.6's "never creates a second stock movement" is an absence rather than a
    // rule: there is nothing in either constructor that could raise a level. The
    // way this breaks is a helpful dependency being injected later, which is
    // exactly what this assertion notices.
    foreach ([ReceiptPriceCompletionService::class, ReceiptLineCosting::class] as $service) {
        $parameters = (new ReflectionClass($service))->getConstructor()?->getParameters() ?? [];

        $types = array_map(
            static fn (ReflectionParameter $parameter): string => (string) $parameter->getType(),
            $parameters,
        );

        expect($types)->not->toContain(InventoryService::class);
    }
});

/* ── the happy path ──────────────────────────────────────────────────────── */

it('prices an unpriced line once, blends it, and raises no second movement', function (): void {
    $world = completionWorld('completes@kitchen.test');

    $movementsBefore = StockMovement::withoutTenancy()->count();
    $levelBefore = StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->value('quantity');

    expect($movementsBefore)->toBe(1)
        ->and($levelBefore)->toBe('10.0000');

    $receipt = completePrices($world, [[
        'goods_receipt_line_id' => completionLineId($world),
        'unit_price_amount' => '2.00',
        'cost_currency_code' => 'USD',
    ]]);

    expect($receipt->cost_status)->toBe('complete');

    $line = GoodsReceiptLine::query()->where('goods_receipt_id', $world->receiptId)->sole();
    expect((string) $line->unit_price_amount)->toBe('2.000000')
        ->and((string) $line->line_total_amount)->toBe('20.000000')
        ->and($line->cost_currency_code)->toBe('USD')
        ->and($line->costed_at)->not->toBeNull();

    // The blend ran exactly once and the shelf did not move again.
    expect(IngredientCostEvent::withoutTenancy()->count())->toBe(1)
        ->and((string) IngredientStockCost::withoutTenancy()->sole()->moving_average_cost_amount)->toBe('2.000000')
        ->and(StockMovement::withoutTenancy()->count())->toBe($movementsBefore)
        ->and(StockLevel::withoutTenancy()->where('stock_item_id', $world->itemId)->value('quantity'))->toBe($levelBefore);
});

it('refuses a second completion of the same line rather than skipping it silently', function (): void {
    $world = completionWorld('twice@kitchen.test');
    $lineId = completionLineId($world);

    completePrices($world, [[
        'goods_receipt_line_id' => $lineId,
        'unit_price_amount' => '2.00',
        'cost_currency_code' => 'USD',
    ]]);

    $again = fn () => completePrices($world, [[
        'goods_receipt_line_id' => $lineId,
        'unit_price_amount' => '9.99',
        'cost_currency_code' => 'USD',
    ]]);

    expect($again)->toThrow(ApiException::class, 'This line has already been priced.');

    // The first figure stands and the average was blended once, not twice.
    $line = GoodsReceiptLine::query()->where('goods_receipt_id', $world->receiptId)->sole();
    expect((string) $line->unit_price_amount)->toBe('2.000000')
        ->and(IngredientCostEvent::withoutTenancy()->count())->toBe(1)
        ->and(StockMovement::withoutTenancy()->count())->toBe(1);
});

it('refuses a line that belongs to another receipt', function (): void {
    $world = completionWorld('foreign-line@kitchen.test');
    $other = completionWorld('foreign-line-other@kitchen.test');

    $post = fn () => completePrices($world, [[
        'goods_receipt_line_id' => completionLineId($other),
        'unit_price_amount' => '2.00',
        'cost_currency_code' => 'USD',
    ]]);

    expect($post)->toThrow(ApiException::class, 'That line is not on this receipt.');
});

/* ── the arithmetic and the currency ─────────────────────────────────────── */

it('checks a claimed line total against the quantity and unit price', function (): void {
    $world = completionWorld('line-total@kitchen.test');
    $lineId = completionLineId($world);

    $wrong = fn () => completePrices($world, [[
        'goods_receipt_line_id' => $lineId,
        'unit_price_amount' => '2.00',
        // 10 × 2.00 is 20, not 25.
        'line_total_amount' => '25.00',
        'cost_currency_code' => 'USD',
    ]]);

    expect($wrong)->toThrow(ApiException::class, 'That line total does not match the quantity received at that unit price.');

    completePrices($world, [[
        'goods_receipt_line_id' => $lineId,
        'unit_price_amount' => '2.00',
        'line_total_amount' => '20.00',
        'cost_currency_code' => 'USD',
    ]]);

    expect((string) GoodsReceiptLine::query()->where('goods_receipt_id', $world->receiptId)->sole()->line_total_amount)
        ->toBe('20.000000');
});

it('refuses a currency that disagrees with the lines already priced on the receipt', function (): void {
    $world = completionWorld('two-currencies@kitchen.test');

    app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);

    // A half-priced delivery: the packaging line came with its price on the
    // note, the flour line is still waiting for the invoice.
    $packaging = StockItem::query()->create([
        'organisation_id' => $world->organisationId,
        'code' => 'PKG-1',
        'name_en' => 'Takeaway boxes',
        'unit_code' => 'piece',
        'unit_id' => (string) MeasurementUnit::query()->where('code', 'piece')->value('id'),
        'ingredient_id' => null,
    ]);

    $receipt = app(GoodsReceiptService::class)->post(
        $world->organisationId,
        (string) $world->branch->getKey(),
        null,
        'DN-9002',
        null,
        [
            ['stock_item_id' => (string) $packaging->getKey(), 'quantity' => '20', 'unit_price_amount' => '0.35', 'cost_currency_code' => 'USD'],
            ['stock_item_id' => $world->itemId, 'quantity' => '4', 'unit_id' => $world->kgId],
        ],
    );

    $unpricedLineId = (string) GoodsReceiptLine::query()
        ->where('goods_receipt_id', $receipt->getKey())
        ->whereNull('costed_at')
        ->sole()
        ->getKey();

    app(TenantContext::class)->clear();

    expect($receipt->cost_status)->toBe('partial');

    $post = function () use ($world, $receipt, $unpricedLineId): void {
        app(TenantContext::class)->setOrganisation((string) $world->tenant->user->getKey(), $world->organisationId);

        try {
            app(ReceiptPriceCompletionService::class)->complete(
                GoodsReceipt::query()->findOrFail($receipt->getKey()),
                [['goods_receipt_line_id' => $unpricedLineId, 'unit_price_amount' => '2.00', 'cost_currency_code' => 'EUR']],
            );
        } finally {
            app(TenantContext::class)->clear();
        }
    };

    expect($post)->toThrow(ApiException::class, 'Every priced line on one receipt is in the same currency');
});

/* ── the queue and the endpoint ──────────────────────────────────────────── */

it('lists an unpriced receipt in the queue and drops it once its prices are complete', function (): void {
    $world = completionWorld('queue@kitchen.test');

    $this->actingAs($world->tenant->user);

    $this->getJson('/api/v1/catalogue/procurement/unpriced-receipts', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.unpriced_receipts.0.id', $world->receiptId)
        ->assertJsonPath('data.unpriced_receipts.0.cost_status', 'unpriced')
        ->assertJsonPath('data.unpriced_receipts.0.unpriced_line_count', 1)
        ->assertJsonPath('data.unpriced_receipts.0.valuation_pending_count', 0)
        ->assertJsonPath('data.unpriced_receipts.0.document_ref', 'DN-9001');

    $this->postJson(
        "/api/v1/catalogue/procurement/goods-receipts/{$world->receiptId}/complete-prices",
        ['lines' => [[
            'goods_receipt_line_id' => completionLineId($world),
            'unit_price_amount' => 2.0,
            'cost_currency_code' => 'USD',
        ]]],
        $world->headers,
    )
        ->assertOk()
        ->assertJsonPath('data.goods_receipt.cost_status', 'complete')
        ->assertJsonPath('data.goods_receipt.lines.0.unit_price_amount', '2.000000');

    $this->getJson('/api/v1/catalogue/procurement/unpriced-receipts', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.unpriced_receipts', []);
});

it('forbids the queue and the completion to a manager without the cost permission', function (): void {
    $tenant = PricingWorld::kitchen('no-costs@kitchen.test', [
        'organisation.view_current',
        'branch.view_current',
        'inventory.view_organisation',
        'inventory.manage_organisation',
    ]);

    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'country_code' => $tenant->organisation->country_code,
    ]);

    $headers = PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()];
    $someId = '01935f6d-0000-7000-8000-0000000000aa';

    $this->actingAs($tenant->user);

    // The write at the door is theirs (§5's blind-write model); going back over
    // the money afterwards is not.
    $this->getJson('/api/v1/catalogue/procurement/unpriced-receipts', $headers)->assertForbidden();
    $this->postJson(
        "/api/v1/catalogue/procurement/goods-receipts/{$someId}/complete-prices",
        ['lines' => []],
        $headers,
    )->assertForbidden();
});
