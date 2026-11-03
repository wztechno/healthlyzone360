<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Enums\ReservationStatus;
use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockReservation;
use Healthy360\Inventory\Services\HeldStockForSale;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Inventory\Services\ReservationService;
use Healthy360\Inventory\Services\StockQuarantine;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
| A hold has to bite on the shelf: the copy says held stock cannot be sold or
| used, so these prove the claim it opens stops the consume and the sale, leaves
| free stock beside it alone, and goes away on release.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('hold@kitchen.test');
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->orgId,
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->branchId = (string) $this->branch->getKey();
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant) + ['X-Branch-Id' => $this->branchId];

    quarantineContext($this);

    $ingredient = Ingredient::factory()->create(['organisation_id' => $this->orgId]);
    $this->stockItem = StockItem::withoutTenancy()->firstOrCreate(
        ['organisation_id' => $this->orgId, 'ingredient_id' => (string) $ingredient->getKey()],
        ['name_en' => 'Oil', 'code' => 'oil', 'unit_id' => (string) MeasurementUnit::query()->where('code', 'kg')->value('id')],
    );
    $this->itemId = (string) $this->stockItem->getKey();
    $this->receiptId = (string) Str::uuid();

    $catalogue = Catalogue::factory()->create(['organisation_id' => $this->orgId]);
    $this->sauce = CatalogueItem::factory()->create([
        'organisation_id' => $this->orgId,
        'catalogue_id' => (string) $catalogue->getKey(),
        'item_type' => 'sauce',
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    // Eight on the shelf, five of them from the delivery that goes on hold.
    app(InventoryService::class)->recordMovement($this->orgId, $this->branchId, $this->itemId, 'adjust', '3');
    app(InventoryService::class)->recordMovement($this->orgId, $this->branchId, $this->itemId, 'receipt', '5', 'goods_receipt', $this->receiptId);

    $this->check = $this->postJson('/api/v1/catalogue/quality-control/checks', [
        'subject_type' => 'goods_receipt',
        'subject_id' => $this->receiptId,
    ], $this->headers)->assertCreated()->json('data.quality_check.id');
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * The kitchen's context for calling the services directly. A request clears it on
 * the way out, so it goes back after each one.
 */
function quarantineContext(object $test): void
{
    app(TenantContext::class)->setOrganisation((string) $test->tenant->user->getKey(), $test->orgId);
}

it('sets aside what the held delivery brought in and no more', function (): void {
    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/hold", [], $this->headers)->assertOk();
    quarantineContext($this);

    expect(app(ReservationService::class)->availableQuantity($this->branchId, $this->itemId))->toBe('3.000000');

    // The free part is still usable.
    app(InventoryService::class)->recordMovement($this->orgId, $this->branchId, $this->itemId, 'consume', '-3');

    expect(fn () => app(InventoryService::class)->recordMovement($this->orgId, $this->branchId, $this->itemId, 'consume', '-1'))
        ->toThrow(InsufficientStock::class);
});

it('refuses a sale only once nothing but held stock is left, and lifts on release', function (): void {
    $sale = app(HeldStockForSale::class);

    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/hold", [], $this->headers)->assertOk();
    quarantineContext($this);

    expect($sale->refuses($this->orgId, $this->sauce, '1'))->toBeFalse();

    app(InventoryService::class)->recordMovement($this->orgId, $this->branchId, $this->itemId, 'waste', '-3');

    expect($sale->refuses($this->orgId, $this->sauce, '1'))->toBeTrue();

    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/release", [], $this->headers)->assertOk();
    quarantineContext($this);

    expect($sale->refuses($this->orgId, $this->sauce, '1'))->toBeFalse()
        ->and(app(ReservationService::class)->availableQuantity($this->branchId, $this->itemId))->toBe('5.000000');
});

it('does not refuse a sale because of a production claim', function (): void {
    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/hold", [], $this->headers)->assertOk();

    // The three free kilos are spoken for by a batch. That is ordinary shortage.
    $claim = new StockReservation;
    $claim->organisation_id = $this->orgId;
    $claim->branch_id = $this->branchId;
    $claim->stock_item_id = $this->itemId;
    $claim->quantity = '3';
    $claim->holder_type = StockReservation::HOLDER_PRODUCTION_ORDER;
    $claim->holder_id = (string) Str::uuid();
    $claim->status = ReservationStatus::Open;
    $claim->save();

    expect(app(HeldStockForSale::class)->refuses($this->orgId, $this->sauce, '1'))->toBeFalse();
});

it('refuses only what the hold takes away, never a shelf already short', function (): void {
    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/hold", [], $this->headers)->assertOk();
    $quarantine = app(StockQuarantine::class);

    // Eight on hand, five held: four is what the hold stops, ten was never there.
    expect($quarantine->coversOnlyHeld($this->orgId, $this->itemId, '3'))->toBeFalse()
        ->and($quarantine->coversOnlyHeld($this->orgId, $this->itemId, '4'))->toBeTrue()
        ->and($quarantine->coversOnlyHeld($this->orgId, $this->itemId, '10'))->toBeFalse();
});

it('never counts held stock as free, so a short shelf warns where it does not refuse', function (): void {
    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/hold", [], $this->headers)->assertOk();
    $quarantine = app(StockQuarantine::class);

    // Eight on hand, five held, three free. Ten was never there: not refused, but
    // short of what is free, so the customer and the desk are warned (owner, 3 Nov 2026).
    expect($quarantine->shortOfFree($this->orgId, $this->itemId, '3'))->toBeFalse()
        ->and($quarantine->shortOfFree($this->orgId, $this->itemId, '4'))->toBeTrue()
        ->and($quarantine->shortOfFree($this->orgId, $this->itemId, '10'))->toBeTrue()
        ->and($quarantine->coversOnlyHeld($this->orgId, $this->itemId, '10'))->toBeFalse();

    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/release", [], $this->headers)->assertOk();

    // Nothing held: an ordinary shortage, which this does not speak to.
    expect($quarantine->shortOfFree($this->orgId, $this->itemId, '10'))->toBeFalse();
});

it('leaves an empty shelf to the counters, hold or no hold', function (): void {
    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/hold", [], $this->headers)->assertOk();

    DB::table('stock_levels')->where('stock_item_id', $this->itemId)->update(['quantity' => 0]);

    expect(app(StockQuarantine::class)->coversOnlyHeld($this->orgId, $this->itemId, '1'))->toBeFalse();
});

it('holds a shelf once however many checks hold the subject, until the last is released', function (): void {
    $second = $this->postJson('/api/v1/catalogue/quality-control/checks', [
        'subject_type' => 'goods_receipt',
        'subject_id' => $this->receiptId,
    ], $this->headers)->assertCreated()->json('data.quality_check.id');

    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/hold", [], $this->headers)->assertOk();
    $this->postJson("/api/v1/catalogue/quality-control/checks/{$second}/hold", [], $this->headers)->assertOk();

    expect(StockReservation::withoutTenancy()->where('holder_id', $this->receiptId)->where('status', 'open')->count())->toBe(1);

    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/release", [], $this->headers)->assertOk();

    expect(StockReservation::withoutTenancy()->where('holder_id', $this->receiptId)->where('status', 'open')->count())->toBe(1);

    $this->postJson("/api/v1/catalogue/quality-control/checks/{$second}/release", [], $this->headers)->assertOk();

    expect(StockReservation::withoutTenancy()->where('holder_id', $this->receiptId)->where('status', 'open')->count())->toBe(0);
});

it('records who held and who released', function (): void {
    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/hold", [], $this->headers)->assertOk();
    $this->postJson("/api/v1/catalogue/quality-control/checks/{$this->check}/release", [], $this->headers)->assertOk();

    $this->assertDatabaseHas('audit_logs', ['action' => 'quality_check.released', 'subject_id' => $this->check]);
});
