<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Ingredients\Services\IngredientSpreadsheetService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| The ingredient catalogue as a workbook — export, template and import
|--------------------------------------------------------------------------
|
| What has to hold: an import converges rather than duplicates (Reference,
| then name, then create); only what the sheet says moves; a re-upload of an
| untouched export changes nothing at all; and every bad row is reported
| without stopping the rest.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = RecipeWorld::kitchen('sheet-a@kitchen.test', ['catalogue.view_organisation', 'catalogue.manage_organisation']);
    $this->headers = RecipeWorld::headers($this->a) + ['Accept' => 'application/json'];
    $this->actingAs($this->a->user);
});

/**
 * @param  array<string, string>  $headers
 * @param  list<list<string|int|float|null>>  $rows
 */
function postIngredientSheet(array $headers, array $rows): TestResponse
{
    return test()->post('/api/v1/catalogue/ingredients/imports', ['file' => xlsxUpload($rows)], $headers);
}

/**
 * @param  array<string, mixed>  $attributes
 */
function sheetIngredient(object $tenant, array $attributes): Ingredient
{
    return Ingredient::factory()->create(['organisation_id' => $tenant->organisation->getKey()] + $attributes);
}

/**
 * @return list<list<string|null>>
 */
function downloadedSheet(TestResponse $response): array
{
    return readXlsx($response->baseResponse->getFile()->getPathname());
}

it('creates a food row owing its nutrition reference, numbered ING-, audited per row and once for the import', function (): void {
    $response = postIngredientSheet($this->headers, [
        ['Name (EN)', 'Unit', 'Unit price', 'Price currency'],
        ['Sheet sumac', 'KG', 4.5, 'usd'],
    ])->assertOk()
        ->assertJsonPath('data.created', 1)
        ->assertJsonPath('data.failed', 0)
        ->assertJsonPath('data.rows.0.row', 2)
        ->assertJsonPath('data.rows.0.outcome', 'created');

    expect($response->json('data.rows.0.reference'))->toMatch('/^ING-\d+$/');

    $created = Ingredient::withoutTenancy()->where('name_en', 'Sheet sumac')->sole();

    expect($created->pending_nutrition)->not->toBeNull()
        ->and($created->source_ref)->toBe($response->json('data.rows.0.reference'))
        ->and($created->default_unit_id)->toBe(RecipeWorld::unit('kg'))
        ->and($created->unit_price_amount)->toBe('4.500000')
        ->and($created->price_currency_code)->toBe('USD')
        ->and(AuditLog::query()->where('action', 'catalogue.ingredient_created')->count())->toBe(1);

    $summary = AuditLog::query()->where('action', 'catalogue.ingredients_imported')->sole();

    expect($summary->metadata)->toMatchArray(['row_count' => 1, 'created' => 1, 'updated' => 0, 'failed' => 0]);
});

it('creates packaging in the PKG- series without a pending-nutrition marker', function (): void {
    RecipeWorld::packagingCategory();

    $response = postIngredientSheet($this->headers, [
        ['Name (EN)', 'Category', 'Unit', 'Purchase price', 'Purchase currency'],
        ['Sheet clamshell', 'packaging-disposables', 'piece', '0.2', 'USD'],
    ])->assertOk()->assertJsonPath('data.created', 1);

    expect($response->json('data.rows.0.reference'))->toMatch('/^PKG-\d+$/');

    $created = Ingredient::withoutTenancy()->where('name_en', 'Sheet clamshell')->sole();

    expect($created->pending_nutrition)->toBeNull()
        ->and($created->purchase_price_amount)->toBe('0.200000');
});

it('updates the row its Reference names', function (): void {
    $lentils = sheetIngredient($this->a, ['name_en' => 'Sheet lentils', 'source_ref' => 'ING-001']);

    postIngredientSheet($this->headers, [
        ['Reference', 'Unit price', 'Price currency'],
        ['ING-001', 3, 'USD'],
    ])->assertOk()
        ->assertJsonPath('data.updated', 1)
        ->assertJsonPath('data.rows.0.reference', 'ING-001');

    $lentils->refresh();

    expect($lentils->unit_price_amount)->toBe('3.000000')
        ->and($lentils->lock_version)->toBe(1)
        ->and(Ingredient::withoutTenancy()->count())->toBe(1);
});

it('matches a row without a Reference by its exact name, ignoring case', function (): void {
    $bulgur = sheetIngredient($this->a, ['name_en' => 'Sheet bulgur', 'source_ref' => 'ING-002']);

    postIngredientSheet($this->headers, [
        ['Name (EN)', 'Notes'],
        ['sheet BULGUR', 'Coarse'],
    ])->assertOk()->assertJsonPath('data.updated', 1)->assertJsonPath('data.created', 0);

    expect($bulgur->refresh()->notes)->toBe('Coarse');
});

it('matches a row without a Reference by an alias', function (): void {
    $garbanzo = sheetIngredient($this->a, ['name_en' => 'Sheet garbanzo', 'source_ref' => 'ING-003']);
    IngredientAlias::factory()->create(['ingredient_id' => $garbanzo->getKey(), 'alias' => 'Sheet chickpea']);

    postIngredientSheet($this->headers, [
        ['Name (EN)', 'Notes'],
        ['Sheet chickpea', 'Soaked overnight'],
    ])->assertOk()->assertJsonPath('data.updated', 1)->assertJsonPath('data.created', 0);

    expect($garbanzo->refresh()->notes)->toBe('Soaked overnight')
        ->and($garbanzo->name_en)->toBe('Sheet garbanzo');
});

it('refuses a Reference that names no ingredient rather than creating one', function (): void {
    postIngredientSheet($this->headers, [
        ['Reference', 'Name (EN)', 'Unit'],
        ['ING-999', 'Sheet ghost', 'g'],
    ])->assertOk()
        ->assertJsonPath('data.failed', 1)
        ->assertJsonPath('data.rows.0.reference', 'ING-999')
        ->assertJsonPath('data.rows.0.message', 'No ingredient has reference ING-999.');

    expect(Ingredient::withoutTenancy()->where('name_en', 'Sheet ghost')->exists())->toBeFalse();
});

it('refuses a name two of the kitchen\'s rows share', function (): void {
    sheetIngredient($this->a, ['name_en' => 'Sheet twin']);
    sheetIngredient($this->a, ['name_en' => 'Sheet twin']);

    $response = postIngredientSheet($this->headers, [
        ['Name (EN)', 'Notes'],
        ['Sheet twin', 'Which one?'],
    ])->assertOk()->assertJsonPath('data.failed', 1);

    expect($response->json('data.rows.0.message'))->toContain('2 ingredients are named Sheet twin; add the Reference');
});

it('skips a changed platform row with the fork message and counts an untouched one unchanged', function (): void {
    $saffron = Ingredient::factory()->platform()->create(['name_en' => 'Sheet saffron', 'source_ref' => 'ING-500', 'notes' => null]);

    postIngredientSheet($this->headers, [
        ['Reference', 'Name (EN)', 'Notes'],
        ['ING-500', 'Sheet saffron', 'Ours now'],
        ['ING-500', 'Sheet saffron', null],
    ])->assertOk()
        ->assertJsonPath('data.skipped', 1)
        ->assertJsonPath('data.unchanged', 1)
        ->assertJsonPath('data.rows.0.message', 'Platform library row — fork it in the app to edit it');

    expect($saffron->refresh()->notes)->toBeNull()
        ->and($saffron->lock_version)->toBe(0);
});

it('names the column of a code it does not know', function (): void {
    $response = postIngredientSheet($this->headers, [
        ['Name (EN)', 'Unit'],
        ['Sheet typo', 'kgg'],
    ])->assertOk()->assertJsonPath('data.failed', 1);

    expect($response->json('data.rows.0.message'))->toBe("Unit: 'kgg' is not a known unit code.")
        ->and(Ingredient::withoutTenancy()->count())->toBe(0);
});

it('refuses a price without its currency', function (): void {
    $response = postIngredientSheet($this->headers, [
        ['Name (EN)', 'Unit', 'Unit price'],
        ['Sheet unpriced', 'kg', 2],
    ])->assertOk()->assertJsonPath('data.failed', 1);

    expect($response->json('data.rows.0.message'))->toContain('Price currency')
        ->and(Ingredient::withoutTenancy()->count())->toBe(0);
});

it('leaves a stored value standing under a blank cell, and reads the stored currency for a new price', function (): void {
    $oil = sheetIngredient($this->a, [
        'name_en' => 'Sheet oil', 'source_ref' => 'ING-004', 'notes' => 'Keep me',
        'unit_price_amount' => '2', 'price_currency_code' => 'USD',
    ]);

    postIngredientSheet($this->headers, [
        ['Reference', 'Notes', 'Unit price', 'Price currency'],
        ['ING-004', null, 5, null],
    ])->assertOk()->assertJsonPath('data.updated', 1);

    $oil->refresh();

    expect($oil->notes)->toBe('Keep me')
        ->and($oil->unit_price_amount)->toBe('5.000000')
        ->and($oil->price_currency_code)->toBe('USD');
});

it('never touches a field whose column the sheet leaves out', function (): void {
    $tahini = sheetIngredient($this->a, ['name_en' => 'Sheet tahini', 'source_ref' => 'ING-005', 'notes' => 'Stays', 'composition' => 'Sesame']);

    postIngredientSheet($this->headers, [
        ['Reference', 'Name (AR)'],
        ['ING-005', 'طحينة'],
    ])->assertOk()->assertJsonPath('data.updated', 1);

    $tahini->refresh();

    expect($tahini->name_ar)->toBe('طحينة')
        ->and($tahini->notes)->toBe('Stays')
        ->and($tahini->composition)->toBe('Sesame');
});

it('re-imports its own export as all unchanged, without moving a lock version', function (): void {
    $legume = IngredientCategory::factory()->platform()->create(['code' => 'sheet-legume']);
    $dry = IngredientCategory::factory()->platform()->create(['code' => 'sheet-legume-dry', 'parent_id' => $legume->getKey()]);

    sheetIngredient($this->a, [
        'name_en' => 'Sheet freekeh', 'source_ref' => 'ING-010',
        'ingredient_category_id' => $legume->getKey(), 'ingredient_subcategory_id' => $dry->getKey(),
        'default_unit_id' => RecipeWorld::unit('kg'), 'purchase_unit_id' => RecipeWorld::unit('bag'),
        'items_per_unit' => '25', 'grams_per_unit' => '1000', 'yield_factor' => '2.75',
        'unit_price_amount' => '3.125', 'b2b_price_amount' => '4', 'b2c_price_amount' => '0.000001', 'price_currency_code' => 'USD',
        'availability_tier' => 'core', 'is_sellable' => true, 'composition' => 'Roasted green wheat', 'notes' => '=SUM(A1)',
    ]);
    sheetIngredient($this->a, ['name_en' => 'Sheet rice', 'source_ref' => 'ING-011', 'ingredient_category_id' => $legume->getKey()]);
    sheetIngredient($this->a, ['name_en' => 'Sheet unnumbered']);
    Ingredient::factory()->platform()->create(['name_en' => 'Sheet cumin', 'source_ref' => 'ING-012']);
    $yoghurt = RecipeWorld::mappedIngredient($this->a->organisation, 'Sheet yoghurt', 'milk');
    $yoghurt->source_ref = 'ING-013';
    $yoghurt->save();
    RecipeWorld::packagingItem($this->a->organisation, 'Sheet bottle', '0.35', '0.3');

    $before = Ingredient::withoutTenancy()->pluck('lock_version', 'id')->sortKeys()->all();

    $export = $this->get('/api/v1/catalogue/ingredients/export', $this->headers)
        ->assertDownload('ingredients-'.now()->format('Y-m-d').'.xlsx');

    $sheet = downloadedSheet($export);
    $byName = collect($sheet)->keyBy(1);

    expect($sheet[0])->toBe([...IngredientSpreadsheetService::HEADERS, ...IngredientSpreadsheetService::READ_ONLY_HEADERS])
        ->and($sheet)->toHaveCount(7)
        ->and($byName['Sheet freekeh'][3])->toBe('sheet-legume-dry')
        ->and($byName['Sheet freekeh'][9])->toBe('3.125')
        ->and($byName['Sheet freekeh'][19])->toBe('yes')
        ->and($byName['Sheet freekeh'][21])->toBe('=SUM(A1)')
        ->and($byName['Sheet yoghurt'][24])->toBe('milk');

    $copy = (string) tempnam(sys_get_temp_dir(), 'h360-test-roundtrip-');
    copy($export->baseResponse->getFile()->getPathname(), $copy);
    $upload = new UploadedFile($copy, 'export.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);

    $this->post('/api/v1/catalogue/ingredients/imports', ['file' => $upload], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.unchanged', 6)
        ->assertJsonPath('data.created', 0)
        ->assertJsonPath('data.updated', 0)
        ->assertJsonPath('data.skipped', 0)
        ->assertJsonPath('data.failed', 0)
        ->assertJsonPath('data.ignored_columns', [])
        ->assertJsonPath('data.rows', []);

    expect(Ingredient::withoutTenancy()->pluck('lock_version', 'id')->sortKeys()->all())->toBe($before)
        ->and(AuditLog::query()->where('action', 'catalogue.ingredient_updated')->count())->toBe(0);
});

it('exports what the list filters and sorts by', function (): void {
    $first = IngredientCategory::factory()->platform()->create(['code' => 'sheet-first']);
    $second = IngredientCategory::factory()->platform()->create(['code' => 'sheet-second']);
    sheetIngredient($this->a, ['name_en' => 'Sheet alpha', 'ingredient_category_id' => $first->getKey()]);
    sheetIngredient($this->a, ['name_en' => 'Sheet beta', 'ingredient_category_id' => $second->getKey()]);
    sheetIngredient($this->a, ['name_en' => 'Sheet gamma', 'status' => IngredientStatus::Archived]);

    $names = function (string $query): array {
        $response = $this->get('/api/v1/catalogue/ingredients/export?'.$query, $this->headers)->assertOk();

        return array_column(array_slice(downloadedSheet($response), 1), 1);
    };

    expect($names('status=archived'))->toBe(['Sheet gamma'])
        ->and($names('category='.$first->getKey()))->toBe(['Sheet alpha'])
        ->and($names('exclude_category='.$first->getKey()))->toBe(['Sheet beta'])
        ->and($names('query=beta'))->toBe(['Sheet beta'])
        ->and($names('sort=name_en&direction=desc'))->toBe(['Sheet beta', 'Sheet alpha']);

    $this->get('/api/v1/catalogue/ingredients/export?sort=colour', $this->headers)->assertStatus(400);
});

it('serves a template of headers and one example row, which an import skips', function (): void {
    $template = $this->get('/api/v1/catalogue/ingredients/import-template', $this->headers)
        ->assertDownload('ingredients-import-template.xlsx');

    $sheet = downloadedSheet($template);

    expect($sheet)->toHaveCount(2)
        ->and($sheet[0])->toBe(IngredientSpreadsheetService::HEADERS)
        ->and($sheet[1][0])->toBe('EXAMPLE');

    $copy = (string) tempnam(sys_get_temp_dir(), 'h360-test-template-');
    copy($template->baseResponse->getFile()->getPathname(), $copy);
    $upload = new UploadedFile($copy, 'template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);

    $this->post('/api/v1/catalogue/ingredients/imports', ['file' => $upload], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.skipped', 1)
        ->assertJsonPath('data.rows.0.message', 'Example row');

    expect(Ingredient::withoutTenancy()->count())->toBe(0);
});

it('refuses an import without manage and an export without view', function (): void {
    $viewer = RecipeWorld::kitchen('sheet-viewer@kitchen.test', ['catalogue.view_organisation']);
    $this->actingAs($viewer->user);

    postIngredientSheet(RecipeWorld::headers($viewer) + ['Accept' => 'application/json'], [
        ['Name (EN)', 'Unit'],
        ['Sheet forbidden', 'g'],
    ])->assertForbidden();

    $stranger = RecipeWorld::kitchen('sheet-stranger@kitchen.test', []);
    $this->actingAs($stranger->user);

    $this->get('/api/v1/catalogue/ingredients/export', RecipeWorld::headers($stranger) + ['Accept' => 'application/json'])->assertForbidden();

    expect(Ingredient::withoutTenancy()->count())->toBe(0);
});
