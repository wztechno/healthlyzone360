<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Services\StockCountSpreadsheetService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| The stock count sheet
|--------------------------------------------------------------------------
|
| One branch's shelves out as a workbook and a counted workbook back in. The
| import goes through the same two service calls the single-item endpoints do
| — a count and a threshold — so what is pinned here is the sheet's own
| contract: blank leaves alone, unknown codes never mint a shelf, the export
| never carries a count that a stale re-upload could replay.
|
*/

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);
    $this->tenant = PricingWorld::kitchen('counts@kitchen.test');
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant) + [
        'X-Branch-Id' => (string) $this->branch->getKey(),
        'Accept' => 'application/json',
    ];
    $this->item = StockItem::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'code' => 'rice-01',
        'name_en' => 'Rice',
        'unit_code' => 'kg',
    ]);
    $this->shelf = ['branch_id' => (string) $this->branch->getKey(), 'stock_item_id' => (string) $this->item->getKey()];
});

/**
 * @param  list<list<string|int|float|null>>  $rows
 * @param  array<string, string>|null  $headers
 */
function stockCountImport(array $rows, ?array $headers = null): TestResponse
{
    return test()->post('/api/v1/catalogue/inventory/counts/imports', [
        'file' => xlsxUpload([StockCountSpreadsheetService::HEADERS, ...$rows]),
    ], $headers ?? test()->headers);
}

function stockCountRiceLevel(): ?StockLevel
{
    return StockLevel::withoutTenancy()->where('stock_item_id', test()->item->getKey())->first();
}

/**
 * @return list<list<string|null>>
 */
function stockCountDownloadedSheet(TestResponse $response): array
{
    $path = $response->baseResponse->getFile()->getPathname();
    $rows = readXlsx($path);
    unlink($path);

    return $rows;
}

it('posts a count as an adjust movement and leaves the level on the counted figure', function (): void {
    $this->postJson('/api/v1/catalogue/inventory/adjustments', $this->shelf + ['quantity_delta' => 10], $this->headers)->assertCreated();

    stockCountImport([['rice-01', 'Rice', 7.5, null, null]])
        ->assertOk()
        ->assertJsonPath('data.updated', 1)
        ->assertJsonPath('data.rows.0.reference', 'rice-01')
        ->assertJsonPath('data.rows.0.outcome', 'updated');

    expect(stockCountRiceLevel()?->quantity)->toBe('7.5000')
        ->and(StockMovement::withoutTenancy()->where('stock_item_id', $this->item->getKey())->where('reason', 'adjust')->where('notes', 'Count sheet import')->sole()->quantity_delta)
        ->toBe('-2.5000');
});

it('posts a repeated identical count as a zero movement and leaves the level unchanged', function (): void {
    stockCountImport([['rice-01', null, 4, null, null]])->assertOk();
    stockCountImport([['rice-01', null, 4, null, null]])->assertOk()->assertJsonPath('data.updated', 1);

    $deltas = StockMovement::withoutTenancy()
        ->where('stock_item_id', $this->item->getKey())
        ->where('notes', 'Count sheet import')
        ->pluck('quantity_delta')
        ->sort()
        ->values()
        ->all();

    expect($deltas)->toBe(['0.0000', '4.0000'])
        ->and(stockCountRiceLevel()?->quantity)->toBe('4.0000');
});

it('sets the threshold and par, audited as a threshold set', function (): void {
    stockCountImport([['rice-01', null, null, 3, 12]])->assertOk()->assertJsonPath('data.updated', 1);

    expect(stockCountRiceLevel()?->reorder_threshold)->toBe('3.0000')
        ->and(stockCountRiceLevel()?->par_level)->toBe('12.0000')
        ->and(AuditLog::query()->where('action', 'inventory.threshold_set')->where('subject_id', stockCountRiceLevel()?->getKey())->exists())->toBeTrue();

    // The same figures again move nothing and say so.
    stockCountImport([['rice-01', null, null, 3, 12]])
        ->assertOk()
        ->assertJsonPath('data.unchanged', 1)
        ->assertJsonPath('data.updated', 0);

    // Par alone keeps the stored threshold rather than clearing it.
    stockCountImport([['rice-01', null, null, null, 20]])->assertOk()->assertJsonPath('data.updated', 1);

    expect(stockCountRiceLevel()?->reorder_threshold)->toBe('3.0000')
        ->and(stockCountRiceLevel()?->par_level)->toBe('20.0000');
});

it('fails a row whose par does not sit above its threshold, and posts none of it', function (): void {
    stockCountImport([['rice-01', null, 9, 5, 5]])
        ->assertOk()
        ->assertJsonPath('data.failed', 1)
        ->assertJsonPath('data.rows.0.outcome', 'failed')
        ->assertJsonPath('data.rows.0.message', 'The restock level must be above the reorder threshold.');

    // The count on the same row rolled back with it.
    expect(stockCountRiceLevel()?->quantity ?? '0.0000')->toBe('0.0000')
        ->and(StockMovement::withoutTenancy()->where('stock_item_id', $this->item->getKey())->exists())->toBeFalse();
});

it('fails a row with a negative count against its header label', function (): void {
    stockCountImport([['rice-01', null, -1, null, null]])
        ->assertOk()
        ->assertJsonPath('data.failed', 1)
        ->assertJsonPath('data.rows.0.message', fn (string $message): bool => str_contains($message, 'Counted quantity'));
});

it('skips an unknown code and never creates a stock item, and skips the example row', function (): void {
    $before = StockItem::withoutTenancy()->count();

    stockCountImport([
        StockCountSpreadsheetService::EXAMPLE,
        ['no-such-shelf', 'Ghost', 5, null, null],
    ])
        ->assertOk()
        ->assertJsonPath('data.skipped', 2)
        ->assertJsonPath('data.rows.0.message', 'Example row.')
        ->assertJsonPath('data.rows.1.reference', 'no-such-shelf');

    expect(StockItem::withoutTenancy()->count())->toBe($before)
        ->and(StockItem::withoutTenancy()->where('code', 'no-such-shelf')->exists())->toBeFalse();
});

it('leaves the level alone when the counted quantity is blank', function (): void {
    $this->postJson('/api/v1/catalogue/inventory/adjustments', $this->shelf + ['quantity_delta' => 6], $this->headers)->assertCreated();

    stockCountImport([['rice-01', 'Rice', null, null, null]])
        ->assertOk()
        ->assertJsonPath('data.unchanged', 1);

    expect(stockCountRiceLevel()?->quantity)->toBe('6.0000')
        ->and(StockMovement::withoutTenancy()->where('notes', 'Count sheet import')->exists())->toBeFalse();
});

it('refuses an organisation-wide member of a two-branch kitchen who names no branch', function (): void {
    OrganisationBranch::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $headers = PricingWorld::headers($this->tenant) + ['Accept' => 'application/json'];

    stockCountImport([['rice-01', null, 5, null, null]], $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'context.branch_required');

    $this->get('/api/v1/catalogue/inventory/levels/export', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'context.branch_required');

    expect(StockMovement::withoutTenancy()->exists())->toBeFalse();
});

it('records one summary audit per import with the counts', function (): void {
    stockCountImport([
        ['rice-01', null, 5, null, null],
        ['no-such-shelf', null, 5, null, null],
    ])->assertOk();

    $audit = AuditLog::query()->where('action', 'inventory.count_sheet_imported')->sole();

    expect($audit->branch_id)->toBe((string) $this->branch->getKey())
        ->and($audit->metadata)->toMatchArray(['updated' => 1, 'skipped' => 1, 'failed' => 0, 'unchanged' => 0]);
});

it('exports the header branch\'s shelves with the count blank and the ledger in On hand, costs for the cost holder', function (): void {
    $other = OrganisationBranch::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $oil = Ingredient::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'name_en' => 'Olive oil',
        'default_unit_id' => (string) $kg->getKey(),
    ]);
    $oilItem = StockItem::withoutTenancy()->where('ingredient_id', (string) $oil->getKey())->sole();
    IngredientStockCost::withoutTenancy()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'ingredient_id' => (string) $oil->getKey(),
        'unit_id' => (string) $kg->getKey(),
        'quantity_on_hand' => '0',
        'moving_average_cost_amount' => '4.25',
        'currency_code' => $this->tenant->organisation->default_currency_code,
    ]);

    $this->postJson('/api/v1/catalogue/inventory/adjustments', $this->shelf + ['quantity_delta' => 10], $this->headers)->assertCreated();
    $this->postJson('/api/v1/catalogue/inventory/adjustments', ['branch_id' => (string) $other->getKey(), 'stock_item_id' => (string) $this->item->getKey(), 'quantity_delta' => 99], $this->headers)->assertCreated();
    $this->patchJson('/api/v1/catalogue/inventory/threshold', $this->shelf + ['reorder_threshold' => 10, 'par_level' => 30], $this->headers)->assertOk();

    $response = $this->get('/api/v1/catalogue/inventory/levels/export', $this->headers)->assertOk();

    expect($response->headers->get('Content-Disposition'))->toContain('stock-count-'.now()->format('Y-m-d').'.xlsx');

    $sheet = stockCountDownloadedSheet($response);
    $byCode = collect(array_slice($sheet, 1))->keyBy(0);

    expect($sheet[0])->toBe([...StockCountSpreadsheetService::HEADERS, 'Unit', 'On hand', 'Low', 'Unit cost', 'Currency'])
        ->and($byCode['rice-01'])->toBe(['rice-01', 'Rice', null, '10', '30', 'kg', '10', 'Yes', null, null])
        ->and($byCode[$oilItem->code][7])->toBe('No')
        ->and($byCode[$oilItem->code][8])->toBe('4.25')
        ->and($byCode[$oilItem->code][9])->toBe($this->tenant->organisation->default_currency_code);

    // Without the cost code the money columns are not there at all.
    $permissions = array_values(array_diff(PricingWorld::FULL_PERMISSIONS, ['inventory.view_costs_organisation']));
    $plain = PricingWorld::kitchen('nocost@kitchen.test', $permissions);
    $plainBranch = OrganisationBranch::factory()->create([
        'organisation_id' => $plain->organisation->getKey(),
        'country_code' => $plain->organisation->country_code,
    ]);

    $plainSheet = stockCountDownloadedSheet($this->actingAs($plain->user)->get('/api/v1/catalogue/inventory/levels/export', PricingWorld::headers($plain) + [
        'X-Branch-Id' => (string) $plainBranch->getKey(),
        'Accept' => 'application/json',
    ])->assertOk());

    expect($plainSheet[0])->toBe([...StockCountSpreadsheetService::HEADERS, 'Unit', 'On hand', 'Low']);
});

it('re-imports its own export without reporting the read-only columns', function (): void {
    $sheet = stockCountDownloadedSheet($this->get('/api/v1/catalogue/inventory/levels/export', $this->headers)->assertOk());

    $this->post('/api/v1/catalogue/inventory/counts/imports', ['file' => xlsxUpload($sheet)], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.ignored_columns', [])
        ->assertJsonPath('data.updated', 0);

    expect(StockMovement::withoutTenancy()->exists())->toBeFalse();
});

it('serves a template whose only row is the example', function (): void {
    $sheet = stockCountDownloadedSheet(
        $this->get('/api/v1/catalogue/inventory/counts/import-template', PricingWorld::headers($this->tenant))->assertOk(),
    );

    expect($sheet)->toHaveCount(2)
        ->and($sheet[0])->toBe(StockCountSpreadsheetService::HEADERS)
        ->and($sheet[1][0])->toBe('EXAMPLE');
});

it('still sets a threshold through the endpoint after the move into the service, and still refuses a low par', function (): void {
    $this->patchJson('/api/v1/catalogue/inventory/threshold', $this->shelf + ['reorder_threshold' => 3, 'par_level' => 10], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.level.reorder_threshold', '3.0000')
        ->assertJsonPath('data.level.par_level', '10.0000')
        ->assertJsonPath('data.level.item_code', 'rice-01');

    expect(AuditLog::query()->where('action', 'inventory.threshold_set')->where('actor_user_id', $this->tenant->user->getKey())->count())->toBe(1);

    $this->patchJson('/api/v1/catalogue/inventory/threshold', $this->shelf + ['reorder_threshold' => 10], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(stockCountRiceLevel()?->reorder_threshold)->toBe('3.0000');
});
