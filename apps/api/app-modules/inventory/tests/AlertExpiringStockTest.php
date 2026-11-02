<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Jobs\AlertExpiringStock;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/*
| The window is the logic worth pinning: a date inside it with stock on the shelf
| alerts once, and a far date or an empty shelf stays quiet.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    Mail::fake();
    $this->withoutDefer();
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00:00', 'Asia/Beirut'));

    $this->tenant = PricingWorld::kitchen('expiry@kitchen.test', ['order.supervise_organisation']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->branchId = (string) OrganisationBranch::factory()->create([
        'organisation_id' => $this->orgId,
        'country_code' => $this->tenant->organisation->country_code,
    ])->getKey();

    $ingredient = Ingredient::factory()->create(['organisation_id' => $this->orgId]);
    $this->itemId = (string) StockItem::withoutTenancy()->firstOrCreate(
        ['organisation_id' => $this->orgId, 'ingredient_id' => (string) $ingredient->getKey()],
        ['name_en' => 'Yoghurt', 'code' => 'yoghurt'],
    )->getKey();

    app(InventoryService::class)->recordMovement($this->orgId, $this->branchId, $this->itemId, 'adjust', '4');
});

function expiringLine(string $on): string
{
    $receiptId = (string) Str::uuid();
    $lineId = (string) Str::uuid();

    DB::table('goods_receipts')->insert([
        'id' => $receiptId,
        'organisation_id' => test()->orgId,
        'branch_id' => test()->branchId,
        'received_at' => now(),
    ]);
    DB::table('goods_receipt_lines')->insert([
        'id' => $lineId,
        'goods_receipt_id' => $receiptId,
        'stock_item_id' => test()->itemId,
        'quantity' => '4',
        'expires_on' => $on,
    ]);

    return $lineId;
}

it('alerts the managers once about a delivery line about to pass its date', function (): void {
    $lineId = expiringLine('2026-11-04');
    expiringLine('2026-12-01');

    app()->call([new AlertExpiringStock, 'handle']);
    app()->call([new AlertExpiringStock, 'handle']);

    $rows = StaffNotification::withoutTenancy()->where('type', StaffAlertType::StockExpiring->value)->get();

    expect($rows)->toHaveCount(1)
        ->and($rows->first()->subject_id)->toBe($lineId)
        ->and($rows->first()->subject_type)->toBe('stock');
});

it('stays quiet about an empty shelf', function (): void {
    expiringLine('2026-11-04');
    app(InventoryService::class)->recordMovement($this->orgId, $this->branchId, $this->itemId, 'waste', '-4');

    app()->call([new AlertExpiringStock, 'handle']);

    expect(StaffNotification::withoutTenancy()->count())->toBe(0);
});

it('links to the stock page, and everything else to its order', function (): void {
    $id = (string) Str::uuid();

    expect(StaffAlertType::StockExpiring->page($id))->toBe('/kitchen/stock')
        ->and(StaffAlertType::DeliveryFailed->page($id))->toBe('/kitchen/orders?view='.$id);
});
