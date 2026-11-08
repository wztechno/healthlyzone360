<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/*
|--------------------------------------------------------------------------
| Who moved the stock, and what the waste cost
|--------------------------------------------------------------------------
|
| The ledger is written in one place, so the actor is stamped in one place. The
| Activity page reads the ledger and the audit trail, and an old row with no
| actor is shown as it stands.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();

    $this->world = RunWorld::build('stock@kitchen.test', ['inventory.view_organisation', 'inventory.manage_organisation', 'audit.view_organisation']);
    $this->actingAs($this->world->tenant->user);

    $this->organisationId = (string) $this->world->organisation->getKey();
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisationId,
        'country_code' => $this->world->organisation->country_code,
    ]);
    $this->item = StockItem::withoutTenancy()->create([
        'organisation_id' => $this->organisationId,
        'code' => 'FLOUR',
        'name_en' => 'Flour',
        'unit_code' => 'kg',
    ]);
    $this->shelf = ['branch_id' => (string) $this->branch->getKey(), 'stock_item_id' => (string) $this->item->getKey()];

    StockLevel::withoutTenancy()->create([
        'organisation_id' => $this->organisationId,
        'branch_id' => $this->branch->getKey(),
        'stock_item_id' => $this->item->getKey(),
        'quantity' => '10',
    ]);

    $this->today = now('UTC')->toDateString();
});

/**
 * An ingredient's own shelf at the branch, holding ten kilograms, and unless `$average` is null a
 * moving average over a basis of ten.
 *
 * @param  numeric-string|null  $average
 */
function costedShelf(?string $average): StockItem
{
    $test = test();
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $test->organisationId,
        'default_unit_id' => (string) $kg->getKey(),
    ]);
    $item = StockItem::withoutTenancy()->where('ingredient_id', (string) $ingredient->getKey())->sole();

    StockLevel::withoutTenancy()->create([
        'organisation_id' => $test->organisationId,
        'branch_id' => $test->branch->getKey(),
        'stock_item_id' => $item->getKey(),
        'quantity' => '10',
    ]);

    if ($average !== null) {
        IngredientStockCost::withoutTenancy()->create([
            'organisation_id' => $test->organisationId,
            'ingredient_id' => (string) $ingredient->getKey(),
            'unit_id' => (string) $kg->getKey(),
            'quantity_on_hand' => '10',
            'moving_average_cost_amount' => $average,
            'currency_code' => 'USD',
        ]);
    }

    return $item;
}

function costedShelfBasis(StockItem $item): IngredientStockCost
{
    return IngredientStockCost::withoutTenancy()->where('ingredient_id', $item->ingredient_id)->sole();
}

it('stamps who moved the stock', function (): void {
    $this->postJson('/api/v1/catalogue/inventory/waste', $this->shelf + ['quantity' => 1, 'reason' => 'damaged', 'notes' => 'Dropped'], $this->world->headers)
        ->assertCreated();

    expect(StockMovement::withoutTenancy()->where('reason', 'waste')->sole()->actor_user_id)
        ->toBe((string) $this->world->tenant->user->getKey());
});

it('needs a reason for an adjustment and for waste', function (): void {
    $this->postJson('/api/v1/catalogue/inventory/waste', $this->shelf + ['quantity' => 1], $this->world->headers)
        ->assertUnprocessable();
    $this->postJson('/api/v1/catalogue/inventory/adjustments', $this->shelf + ['quantity_delta' => 1], $this->world->headers)
        ->assertUnprocessable();
});

it('names a count that gave no reason, so no movement goes unexplained', function (): void {
    $this->postJson('/api/v1/catalogue/inventory/counts', $this->shelf + ['counted_quantity' => 8], $this->world->headers)
        ->assertCreated();

    expect(StockMovement::withoutTenancy()->where('reason', 'adjust')->sole()->notes)->toBe('Stock count');
});

it('leaves waste unvalued rather than free when no cost is held, and says so', function (): void {
    $this->postJson('/api/v1/catalogue/inventory/waste', $this->shelf + ['quantity' => 1, 'reason' => 'damaged', 'notes' => 'Dropped'], $this->world->headers)
        ->assertCreated();

    $this->getJson('/api/v1/catalogue/stock-activity?from='.$this->today.'&to='.$this->today, $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.waste', [])
        ->assertJsonPath('data.unvalued_waste_count', 1)
        ->assertJsonPath('data.movements.0.cost_minor', null);
});

it('counts a wasted late cancel as waste, at what it cost', function (): void {
    $order = RunWorld::order($this->world, [
        'status' => OrderStatus::Cancelled,
        'cancelled_at' => now(),
        'cancellation_disposition' => 'wasted',
    ]);

    StockMovement::withoutTenancy()->create([
        'organisation_id' => $this->organisationId,
        'branch_id' => $this->branch->getKey(),
        'stock_item_id' => $this->item->getKey(),
        'quantity_delta' => '-2',
        'reason' => 'consume',
        'reference_type' => 'order',
        'reference_id' => $order->getKey(),
        'cost_amount' => '12.500000',
        'cost_currency_code' => 'USD',
    ]);

    $this->getJson('/api/v1/catalogue/stock-activity?from='.$this->today.'&to='.$this->today, $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.waste.0.amount_minor', 1250)
        ->assertJsonPath('data.movements.0.wasted_order', true)
        ->assertJsonPath('data.movements.0.order_number', $order->order_number)
        ->assertJsonPath('data.movements.0.attributed', false);
});

it('reads the audit trail back, naming the order', function (): void {
    $order = RunWorld::order($this->world);

    app(AuditRecorder::class)->record(
        'order.refund_completed',
        actorUserId: (string) $this->world->tenant->user->getKey(),
        subjectType: 'order',
        subjectId: (string) $order->getKey(),
    );

    DB::table('audit_logs')->update(['organisation_id' => $this->organisationId]);

    $this->getJson('/api/v1/catalogue/activity?from='.$this->today.'&to='.$this->today, $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.0.action', 'order.refund_completed')
        ->assertJsonPath('data.0.order_number', $order->order_number);
});

it('keeps both pages from a member without the audit code', function (): void {
    $this->world = RunWorld::build('cook@kitchen.test', ['inventory.view_organisation']);
    $this->actingAs($this->world->tenant->user);

    $this->getJson('/api/v1/catalogue/activity?from='.$this->today.'&to='.$this->today, $this->world->headers)->assertForbidden();
    $this->getJson('/api/v1/catalogue/stock-activity?from='.$this->today.'&to='.$this->today, $this->world->headers)->assertForbidden();
});

it('refuses waste put down to other without a note, and a reason off the list', function (): void {
    $this->postJson('/api/v1/catalogue/inventory/waste', $this->shelf + ['quantity' => 1, 'reason' => 'other'], $this->world->headers)
        ->assertUnprocessable()
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['notes']]]]);
    $this->postJson('/api/v1/catalogue/inventory/waste', $this->shelf + ['quantity' => 1, 'reason' => 'lost'], $this->world->headers)
        ->assertUnprocessable()
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['reason']]]]);

    expect(StockMovement::withoutTenancy()->where('reason', 'waste')->exists())->toBeFalse();
});

it('stores why food was wasted, needs no note for a listed reason, and reads an old row as other', function (): void {
    $this->postJson('/api/v1/catalogue/inventory/waste', $this->shelf + ['quantity' => 1, 'reason' => 'expired'], $this->world->headers)
        ->assertCreated();

    $movement = StockMovement::withoutTenancy()->where('reason', 'waste')->sole();
    expect($movement->waste_reason)->toBe('expired')
        ->and($movement->notes)->toBeNull();

    // A waste row from before the column: the ledger is never back-filled.
    $old = StockMovement::withoutTenancy()->create([
        'organisation_id' => $this->organisationId,
        'branch_id' => $this->branch->getKey(),
        'stock_item_id' => $this->item->getKey(),
        'quantity_delta' => '-1',
        'reason' => 'waste',
        'notes' => 'Dropped',
    ]);

    $reasons = collect($this->getJson('/api/v1/catalogue/stock-activity?from='.$this->today.'&to='.$this->today, $this->world->headers)
        ->assertOk()
        ->json('data.movements'))
        ->pluck('waste_reason', 'id');

    expect($reasons[(string) $movement->getKey()])->toBe('expired')
        ->and($reasons[(string) $old->getKey()])->toBe('other');
});

it('values a count that takes the shelf to zero, and lowers the basis by it', function (): void {
    $item = costedShelf('2.50');

    $this->postJson('/api/v1/catalogue/inventory/counts', ['branch_id' => (string) $this->branch->getKey(), 'stock_item_id' => (string) $item->getKey(), 'counted_quantity' => 0], $this->world->headers)
        ->assertCreated();

    $movement = StockMovement::withoutTenancy()->where('stock_item_id', $item->getKey())->where('reason', 'adjust')->sole();
    $basis = costedShelfBasis($item);

    expect((string) $movement->quantity_delta)->toBe('-10.0000')
        ->and((string) $movement->unit_cost_amount)->toBe('2.500000')
        ->and((string) $movement->cost_amount)->toBe('25.000000')
        ->and($movement->cost_currency_code)->toBe('USD')
        ->and((string) $basis->quantity_on_hand)->toBe('0.000000')
        ->and((string) $basis->moving_average_cost_amount)->toBe('2.500000');
});

it('raises the basis at the current average when a count finds more', function (): void {
    $item = costedShelf('2.50');

    $this->postJson('/api/v1/catalogue/inventory/counts', ['branch_id' => (string) $this->branch->getKey(), 'stock_item_id' => (string) $item->getKey(), 'counted_quantity' => 14], $this->world->headers)
        ->assertCreated();

    $movement = StockMovement::withoutTenancy()->where('stock_item_id', $item->getKey())->where('reason', 'adjust')->sole();
    $basis = costedShelfBasis($item);

    expect((string) $movement->quantity_delta)->toBe('4.0000')
        ->and((string) $movement->cost_amount)->toBe('10.000000')
        ->and((string) $basis->quantity_on_hand)->toBe('14.000000')
        ->and((string) $basis->moving_average_cost_amount)->toBe('2.500000');
});

it('leaves a count unvalued, never free, when no cost is held', function (): void {
    $item = costedShelf(null);

    $this->postJson('/api/v1/catalogue/inventory/counts', ['branch_id' => (string) $this->branch->getKey(), 'stock_item_id' => (string) $item->getKey(), 'counted_quantity' => 7], $this->world->headers)
        ->assertCreated();

    $movement = StockMovement::withoutTenancy()->where('stock_item_id', $item->getKey())->where('reason', 'adjust')->sole();

    expect((string) $movement->quantity_delta)->toBe('-3.0000')
        ->and($movement->cost_amount)->toBeNull()
        ->and($movement->unit_cost_amount)->toBeNull()
        ->and(IngredientStockCost::withoutTenancy()->where('ingredient_id', $item->ingredient_id)->exists())->toBeFalse();
});

it('gives both activity views the order id, so a row can open its order', function (): void {
    $order = RunWorld::order($this->world);

    StockMovement::withoutTenancy()->create([
        'organisation_id' => $this->organisationId,
        'branch_id' => $this->branch->getKey(),
        'stock_item_id' => $this->item->getKey(),
        'quantity_delta' => '-2',
        'reason' => 'consume',
        'reference_type' => 'order',
        'reference_id' => $order->getKey(),
    ]);

    app(AuditRecorder::class)->record(
        'order.refund_completed',
        actorUserId: (string) $this->world->tenant->user->getKey(),
        subjectType: 'order',
        subjectId: (string) $order->getKey(),
    );
    DB::table('audit_logs')->update(['organisation_id' => $this->organisationId]);

    $this->getJson('/api/v1/catalogue/stock-activity?from='.$this->today.'&to='.$this->today, $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.movements.0.order_id', (string) $order->getKey())
        ->assertJsonPath('data.movements.0.waste_reason', null);

    $this->getJson('/api/v1/catalogue/activity?from='.$this->today.'&to='.$this->today, $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.0.order_id', (string) $order->getKey());
});
