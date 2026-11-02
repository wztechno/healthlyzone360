<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
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

it('stamps who moved the stock', function (): void {
    $this->postJson('/api/v1/catalogue/inventory/waste', $this->shelf + ['quantity' => 1, 'notes' => 'Dropped'], $this->world->headers)
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
    $this->postJson('/api/v1/catalogue/inventory/waste', $this->shelf + ['quantity' => 1, 'notes' => 'Dropped'], $this->world->headers)
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
