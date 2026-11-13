<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Services\RecipeSpreadsheetService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| The recipe book as a workbook — import, export and the batch sheet read
|--------------------------------------------------------------------------
|
| What has to hold: rows group by recipe wherever they sit; a new recipe is
| created even with lines it cannot resolve, an existing one is never written
| half; a published version is never touched — a change opens the next draft —
| and an untouched export re-imports as "unchanged"; a line's cost is carried,
| never re-derived; and ambiguity is refused rather than guessed.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('chef@recipe-sheets.test');
    $this->headers = RecipeWorld::headers($this->kitchen) + ['Accept' => 'application/json'];
    $this->grams = RecipeWorld::unit();
    $this->kilograms = RecipeWorld::unit('kg');

    $this->tahini = recipeSheetIngredient($this->kitchen, 'Tahini', 'ING-T01', 'sesame');
    $this->lemon = recipeSheetIngredient($this->kitchen, 'Lemon juice', 'ING-T02', 'citrus');
    $this->garlic = recipeSheetIngredient($this->kitchen, 'Garlic', 'ING-T03', 'allium');

    $this->actingAs($this->kitchen->user);
});

/**
 * A food ingredient this kitchen owns, with an allergen determination (so a recipe on it can
 * publish) and a reference.
 *
 * @param  array<string, mixed>  $attributes
 */
function recipeSheetIngredient(object $tenant, string $name, string $reference, string $allergen = 'sesame', array $attributes = []): Ingredient
{
    $ingredient = RecipeWorld::mappedIngredient($tenant->organisation, $name, $allergen);
    $ingredient->forceFill(['source_ref' => $reference] + $attributes)->save();

    return $ingredient;
}

/**
 * One template row from a key => value map, every other column blank.
 *
 * @param  array<string, string|int|float|null>  $values
 * @return list<string|int|float|null>
 */
function recipeSheetRow(array $values): array
{
    return array_map(static fn (string $key): string|int|float|null => $values[$key] ?? null, array_keys(RecipeSpreadsheetService::HEADERS));
}

/**
 * @param  array<string, string>  $headers
 * @param  list<list<string|int|float|null>>  $rows  data rows; the template header row is prepended
 */
function recipeSheetImport(array $headers, array $rows): TestResponse
{
    return test()->post(
        '/api/v1/catalogue/recipes/imports',
        ['file' => xlsxUpload([array_values(RecipeSpreadsheetService::HEADERS), ...$rows])],
        $headers,
    );
}

/**
 * @param  array<string, string>  $headers
 * @param  list<list<string|null>>  $rows  the whole sheet, header row included
 */
function recipeSheetReimport(array $headers, array $rows): TestResponse
{
    return test()->post('/api/v1/catalogue/recipes/imports', ['file' => xlsxUpload($rows)], $headers);
}

/**
 * @return list<list<string|null>>
 */
function recipeSheetDownload(TestResponse $response): array
{
    return readXlsx($response->baseResponse->getFile()->getPathname());
}

function recipeSheetRecipe(string $name): Recipe
{
    return Recipe::withoutTenancy()->where('name_en', $name)->sole();
}

/**
 * @return EloquentCollection<int, RecipeVersion>
 */
function recipeSheetVersions(Recipe $recipe): EloquentCollection
{
    return RecipeVersion::withoutTenancy()->where('recipe_id', $recipe->getKey())->orderBy('version_number')->get();
}

/**
 * @return EloquentCollection<int, RecipeVersionLine>
 */
function recipeSheetLines(RecipeVersion $version): EloquentCollection
{
    return RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $version->getKey())->orderBy('line_number')->get();
}

/**
 * @param  array<string, string>  $headers
 */
function recipeSheetPublish(Recipe $recipe, int $versionNumber, array $headers): void
{
    $lock = RecipeVersion::withoutTenancy()
        ->where('recipe_id', $recipe->getKey())
        ->where('version_number', $versionNumber)
        ->value('lock_version');

    test()->postJson("/api/v1/catalogue/recipes/{$recipe->getKey()}/versions/{$versionNumber}/publish", [], $headers + ['If-Match' => '"'.$lock.'"'])
        ->assertOk();
}

/**
 * Sheet hummus: Tahini 200 g then Lemon juice 50 g, two kilos in eight pieces.
 *
 * @param  array<string, string>  $headers
 */
function recipeSheetHummus(array $headers): Recipe
{
    recipeSheetImport($headers, [
        recipeSheetRow(['name_en' => 'Sheet hummus', 'yield_quantity' => 2, 'yield_unit' => 'kg', 'yield_pieces' => 8, 'shelf_life_days' => 5, 'ingredient_ref' => 'ING-T01', 'ingredient' => 'Tahini', 'quantity' => 200, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'Sheet hummus', 'ingredient_ref' => 'ING-T02', 'ingredient' => 'Lemon juice', 'quantity' => 50, 'unit' => 'g']),
    ])->assertOk()->assertJsonPath('data.created', 1)->assertJsonPath('data.failed', 0);

    return recipeSheetRecipe('Sheet hummus');
}

// ── Import: create ──────────────────────────────────────────────────────────

it('creates one draft recipe per group, with its yields and its lines in row order', function (): void {
    $response = recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet hummus', 'category' => 'Dips', 'yield_quantity' => 2, 'yield_unit' => 'kg', 'yield_pieces' => 8, 'shelf_life_days' => 5, 'ingredient_ref' => 'ING-T01', 'ingredient' => 'Tahini paste', 'quantity' => 200, 'unit' => 'g', 'comment' => 'Stir first']),
        recipeSheetRow(['name_en' => 'Sheet hummus', 'ingredient_ref' => 'ING-T02', 'quantity' => 50, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'Sheet dip', 'ingredient' => 'Garlic', 'quantity' => 10, 'unit' => 'G']),
    ])->assertOk()
        ->assertJsonPath('data.created', 2)
        ->assertJsonPath('data.failed', 0)
        ->assertJsonPath('data.skipped', 0)
        ->assertJsonPath('data.rows.0.outcome', 'created')
        ->assertJsonPath('data.rows.0.row', 2);

    $hummus = recipeSheetRecipe('Sheet hummus');
    $versions = recipeSheetVersions($hummus);
    $lines = recipeSheetLines($versions->sole());

    expect($response->json('data.rows.0.reference'))->toBe($hummus->source_ref)
        ->and($hummus->recipe_category)->toBe('Dips')
        ->and($hummus->shelf_life_days)->toBe(5)
        ->and($versions->sole()->status)->toBe(RecipeVersionStatus::Draft)
        ->and($versions->sole()->yield_quantity)->toBe('2.0000')
        ->and($versions->sole()->yield_unit_id)->toBe($this->kilograms)
        ->and($versions->sole()->yield_piece_count)->toBe(8)
        ->and($lines->pluck('ingredient_id')->all())->toBe([(string) $this->tahini->getKey(), (string) $this->lemon->getKey()])
        ->and($lines[0]->quantity)->toBe('200.0000')
        ->and($lines[0]->unit_id)->toBe($this->grams)
        ->and($lines[0]->comment)->toBe('Stir first')
        // The cell's wording is the designation; a ref-only line takes the ingredient's name.
        ->and($lines[0]->source_designation)->toBe('Tahini paste')
        ->and($lines[1]->source_designation)->toBe('Lemon juice');

    $dip = recipeSheetLines(recipeSheetVersions(recipeSheetRecipe('Sheet dip'))->sole());

    expect($dip->sole()->ingredient_id)->toBe((string) $this->garlic->getKey())
        ->and(AuditLog::query()->where('action', 'catalogue.recipes_imported')->count())->toBe(1);
});

it('skips an unmatched line on create and still creates the recipe', function (): void {
    recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet hummus', 'ingredient_ref' => 'ING-T01', 'quantity' => 200, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'Sheet hummus', 'ingredient' => 'Unicorn dust', 'quantity' => 5, 'unit' => 'g']),
    ])->assertOk()
        ->assertJsonPath('data.created', 1)
        ->assertJsonPath('data.skipped', 1)
        ->assertJsonFragment(['row' => 3, 'outcome' => 'skipped', 'message' => 'No ingredient named Unicorn dust.']);

    expect(recipeSheetLines(recipeSheetVersions(recipeSheetRecipe('Sheet hummus'))->sole())->sole()->ingredient_id)
        ->toBe((string) $this->tahini->getKey());
});

it('skips a line on an inactive ingredient on create', function (): void {
    recipeSheetIngredient($this->kitchen, 'Old paprika', 'ING-T09', 'sesame', ['status' => IngredientStatus::Inactive]);

    $response = recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet hummus', 'ingredient_ref' => 'ING-T01', 'quantity' => 200, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'Sheet hummus', 'ingredient_ref' => 'ING-T09', 'quantity' => 1, 'unit' => 'g']),
    ])->assertOk()
        ->assertJsonPath('data.created', 1)
        ->assertJsonPath('data.skipped', 1);

    $skipped = collect($response->json('data.rows'))->firstWhere('outcome', 'skipped');

    expect($skipped['row'])->toBe(3)
        ->and($skipped['message'])->toContain('inactive')
        ->and(recipeSheetLines(recipeSheetVersions(recipeSheetRecipe('Sheet hummus'))->sole()))->toHaveCount(1);
});

// ── Import: update ──────────────────────────────────────────────────────────

it('fails the whole group when an existing recipe has an unresolved line, and writes nothing', function (): void {
    $recipe = recipeSheetHummus($this->headers);

    $response = recipeSheetImport($this->headers, [
        recipeSheetRow(['reference' => $recipe->source_ref, 'name_en' => 'Sheet hummus', 'notes' => 'Changed', 'ingredient_ref' => 'ING-T01', 'quantity' => 300, 'unit' => 'g']),
        recipeSheetRow(['reference' => $recipe->source_ref, 'ingredient' => 'Unicorn dust', 'quantity' => 5, 'unit' => 'g']),
    ])->assertOk()
        ->assertJsonPath('data.failed', 1)
        ->assertJsonPath('data.updated', 0)
        ->assertJsonPath('data.rows.0.row', 2)
        ->assertJsonPath('data.rows.0.reference', $recipe->source_ref);

    $lines = recipeSheetLines(recipeSheetVersions($recipe)->sole());

    expect($response->json('data.rows.0.message'))->toContain('Row 3: No ingredient named Unicorn dust.')
        ->and($recipe->fresh()?->notes)->toBeNull()
        ->and($lines)->toHaveCount(2)
        ->and($lines[0]->quantity)->toBe('200.0000');
});

it('opens draft v2 over a published recipe and leaves v1 published', function (): void {
    $recipe = recipeSheetHummus($this->headers);
    recipeSheetPublish($recipe, 1, $this->headers);

    recipeSheetImport($this->headers, [
        recipeSheetRow(['reference' => $recipe->source_ref, 'ingredient_ref' => 'ING-T01', 'quantity' => 250, 'unit' => 'g']),
        recipeSheetRow(['reference' => $recipe->source_ref, 'ingredient_ref' => 'ING-T02', 'quantity' => 50, 'unit' => 'g']),
        recipeSheetRow(['reference' => $recipe->source_ref, 'ingredient_ref' => 'ING-T03', 'quantity' => 5, 'unit' => 'g']),
    ])->assertOk()->assertJsonPath('data.updated', 1)->assertJsonPath('data.failed', 0);

    $versions = recipeSheetVersions($recipe);

    expect($versions)->toHaveCount(2)
        ->and($versions[0]->status)->toBe(RecipeVersionStatus::Published)
        ->and(recipeSheetLines($versions[0])->pluck('quantity')->all())->toBe(['200.0000', '50.0000'])
        ->and($versions[1]->status)->toBe(RecipeVersionStatus::Draft)
        ->and(recipeSheetLines($versions[1])->pluck('quantity')->all())->toBe(['250.0000', '50.0000', '5.0000'])
        // The draft is a copy of the published version: its yields came with it.
        ->and($versions[1]->yield_quantity)->toBe('2.0000');
});

it('replaces an editable draft in place', function (): void {
    $recipe = recipeSheetHummus($this->headers);

    recipeSheetImport($this->headers, [
        recipeSheetRow(['reference' => $recipe->source_ref, 'ingredient_ref' => 'ING-T02', 'quantity' => 60, 'unit' => 'g']),
    ])->assertOk()->assertJsonPath('data.updated', 1);

    $versions = recipeSheetVersions($recipe);

    // A sheet is the whole formulation: the tahini line it no longer lists is gone.
    expect($versions)->toHaveCount(1)
        ->and(recipeSheetLines($versions->sole())->sole()->ingredient_id)->toBe((string) $this->lemon->getKey())
        ->and(recipeSheetLines($versions->sole())->sole()->quantity)->toBe('60.0000');
});

it('re-imports an untouched export as unchanged and opens no draft', function (): void {
    $hummus = recipeSheetHummus($this->headers);
    recipeSheetPublish($hummus, 1, $this->headers);

    recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet dip', 'notes' => 'Keep cold', 'ingredient_ref' => 'ING-T03', 'quantity' => 10, 'unit' => 'g', 'comment' => 'Crushed']),
    ])->assertOk()->assertJsonPath('data.created', 1);

    $sheet = recipeSheetDownload($this->get('/api/v1/catalogue/recipes/export', $this->headers)->assertOk());

    recipeSheetReimport($this->headers, $sheet)
        ->assertOk()
        ->assertJsonPath('data.unchanged', 2)
        ->assertJsonPath('data.updated', 0)
        ->assertJsonPath('data.created', 0)
        ->assertJsonPath('data.failed', 0)
        ->assertJsonPath('data.ignored_columns', []);

    expect(recipeSheetVersions($hummus))->toHaveCount(1)
        ->and(recipeSheetVersions(recipeSheetRecipe('Sheet dip')))->toHaveCount(1);
});

it('updates yields from a header-only group and leaves the lines alone', function (): void {
    $recipe = recipeSheetHummus($this->headers);
    $before = recipeSheetLines(recipeSheetVersions($recipe)->sole())->map->only(['id', 'ingredient_id', 'quantity'])->all();

    recipeSheetImport($this->headers, [
        recipeSheetRow(['reference' => $recipe->source_ref, 'yield_quantity' => 3, 'yield_unit' => 'kg']),
    ])->assertOk()->assertJsonPath('data.updated', 1);

    $version = recipeSheetVersions($recipe)->sole();

    expect($version->yield_quantity)->toBe('3.0000')
        ->and($version->yield_piece_count)->toBe(8)
        ->and(recipeSheetLines($version)->map->only(['id', 'ingredient_id', 'quantity'])->all())->toBe($before);
});

it('rolls a recipe back when its lines would carry a cost the member may not see', function (): void {
    $cook = RecipeWorld::kitchen('cook@recipe-sheets.test', ['recipe.view_organisation', 'recipe.manage_organisation']);
    $headers = RecipeWorld::headers($cook) + ['Accept' => 'application/json'];

    recipeSheetIngredient($cook, 'Priced tahini', 'ING-C01', 'sesame', [
        'purchase_price_amount' => '0.02',
        'purchase_price_currency' => 'USD',
        'purchase_unit_id' => $this->grams,
    ]);

    $this->actingAs($cook->user);

    $response = recipeSheetImport($headers, [
        recipeSheetRow(['name_en' => 'Blind hummus', 'ingredient_ref' => 'ING-C01', 'quantity' => 100, 'unit' => 'g']),
    ])->assertOk()
        ->assertJsonPath('data.failed', 1)
        ->assertJsonPath('data.created', 0);

    expect($response->json('data.rows.0.message'))->toContain('permission to see costs')
        ->and(Recipe::withoutTenancy()->where('name_en', 'Blind hummus')->exists())->toBeFalse();
});

it('reads a sheet sorted by ingredient as one formulation per recipe', function (): void {
    recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet A', 'ingredient_ref' => 'ING-T03', 'quantity' => 1, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'Sheet B', 'ingredient_ref' => 'ING-T03', 'quantity' => 2, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'Sheet A', 'ingredient_ref' => 'ING-T02', 'quantity' => 3, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'Sheet B', 'ingredient_ref' => 'ING-T01', 'quantity' => 4, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'sheet a', 'ingredient_ref' => 'ING-T01', 'quantity' => 5, 'unit' => 'g']),
    ])->assertOk()->assertJsonPath('data.created', 2)->assertJsonPath('data.failed', 0);

    $a = recipeSheetLines(recipeSheetVersions(recipeSheetRecipe('Sheet A'))->sole());
    $b = recipeSheetLines(recipeSheetVersions(recipeSheetRecipe('Sheet B'))->sole());

    expect($a->pluck('quantity')->all())->toBe(['1.0000', '3.0000', '5.0000'])
        ->and($a->pluck('line_number')->all())->toBe([1, 2, 3])
        ->and($b->pluck('quantity')->all())->toBe(['2.0000', '4.0000']);
});

it('fails a group whose rows disagree on Yield quantity', function (): void {
    recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet hummus', 'yield_quantity' => 2, 'yield_unit' => 'kg', 'ingredient_ref' => 'ING-T01', 'quantity' => 200, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'Sheet hummus', 'yield_quantity' => 3, 'ingredient_ref' => 'ING-T02', 'quantity' => 50, 'unit' => 'g']),
    ])->assertOk()
        ->assertJsonPath('data.failed', 1)
        ->assertJsonPath('data.created', 0)
        ->assertJsonPath('data.rows.0.message', 'Row 2 and row 3 disagree on Yield quantity.');

    expect(Recipe::withoutTenancy()->where('name_en', 'Sheet hummus')->exists())->toBeFalse();
});

it('keeps a platform ingredient on its line through export and import when the kitchen holds a fork', function (): void {
    $platform = Ingredient::asPlatformRow(fn (): Ingredient => Ingredient::factory()->create([
        'organisation_id' => null,
        'name_en' => 'Tomato',
        'source_ref' => 'ING-P500',
    ]));

    recipeSheetIngredient($this->kitchen, 'Tomato', 'ING-F900', 'sesame', ['forked_from_ingredient_id' => $platform->getKey()]);

    recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet salsa', 'ingredient_ref' => 'ING-P500', 'ingredient' => 'Tomato', 'quantity' => 300, 'unit' => 'g']),
    ])->assertOk()->assertJsonPath('data.created', 1);

    $sheet = recipeSheetDownload($this->get('/api/v1/catalogue/recipes/export', $this->headers)->assertOk());

    recipeSheetReimport($this->headers, $sheet)->assertOk()->assertJsonPath('data.unchanged', 1)->assertJsonPath('data.failed', 0);

    expect(recipeSheetLines(recipeSheetVersions(recipeSheetRecipe('Sheet salsa'))->sole())->sole()->ingredient_id)
        ->toBe((string) $platform->getKey());
});

it('refuses a name-only line that matches both layers, naming both references', function (): void {
    $platform = Ingredient::asPlatformRow(fn (): Ingredient => Ingredient::factory()->create([
        'organisation_id' => null,
        'name_en' => 'Tomato',
        'source_ref' => 'ING-P500',
    ]));

    recipeSheetIngredient($this->kitchen, 'Tomato', 'ING-F900', 'sesame', ['forked_from_ingredient_id' => $platform->getKey()]);

    $response = recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet salsa', 'ingredient' => 'Tomato', 'quantity' => 300, 'unit' => 'g']),
    ])->assertOk()
        ->assertJsonPath('data.created', 1)
        ->assertJsonPath('data.skipped', 1);

    $message = (string) collect($response->json('data.rows'))->firstWhere('outcome', 'skipped')['message'];

    expect($message)->toContain('Two ingredients are named Tomato')
        ->and($message)->toContain('ING-P500')
        ->and($message)->toContain('ING-F900')
        ->and($message)->toContain('fill in Ingredient ref');
});

it('changes one comment and carries every other line\'s cost and designation exactly', function (): void {
    foreach ([$this->tahini, $this->lemon] as $priced) {
        $priced->forceFill(['purchase_price_amount' => '0.02', 'purchase_price_currency' => 'USD', 'purchase_unit_id' => $this->grams])->save();
    }

    $recipe = recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet hummus', 'ingredient_ref' => 'ING-T01', 'ingredient' => 'Tahini paste', 'quantity' => 200, 'unit' => 'g']),
        recipeSheetRow(['name_en' => 'Sheet hummus', 'ingredient_ref' => 'ING-T02', 'ingredient' => 'Fresh lemon', 'quantity' => 50, 'unit' => 'g', 'comment' => 'Squeezed']),
    ])->assertOk()->assertJsonPath('data.created', 1)->json('data.rows.0.reference');

    $before = recipeSheetLines(recipeSheetVersions(recipeSheetRecipe('Sheet hummus'))->sole());

    // The catalogue moves on; the lines must not follow it.
    $this->tahini->forceFill(['purchase_price_amount' => '9'])->save();

    recipeSheetImport($this->headers, [
        recipeSheetRow(['reference' => $recipe, 'ingredient_ref' => 'ING-T01', 'ingredient' => 'Tahini', 'quantity' => 200, 'unit' => 'g']),
        recipeSheetRow(['reference' => $recipe, 'ingredient_ref' => 'ING-T02', 'ingredient' => 'Lemon juice', 'quantity' => 50, 'unit' => 'g', 'comment' => 'Bottled']),
    ])->assertOk()->assertJsonPath('data.updated', 1)->assertJsonPath('data.failed', 0);

    $after = recipeSheetLines(recipeSheetVersions(recipeSheetRecipe('Sheet hummus'))->sole());

    expect($before[0]->unit_cost_amount)->toBe('0.020000')
        ->and($after[1]->comment)->toBe('Bottled')
        ->and($after[0]->comment)->toBeNull();

    foreach ([0, 1] as $index) {
        expect($after[$index]->unit_cost_amount)->toBe($before[$index]->unit_cost_amount)
            ->and($after[$index]->cost_currency_code)->toBe($before[$index]->cost_currency_code)
            ->and($after[$index]->source_designation)->toBe($before[$index]->source_designation);
    }
});

it('drops a per-gram cost when the sheet moves the line to kilograms, and prices it in the new unit', function (): void {
    foreach ([$this->tahini, $this->lemon] as $priced) {
        $priced->forceFill(['purchase_price_amount' => '0.02', 'purchase_price_currency' => 'USD', 'purchase_unit_id' => $this->grams])->save();
    }

    $recipe = recipeSheetHummus($this->headers);
    $before = recipeSheetLines(recipeSheetVersions($recipe)->sole());

    recipeSheetImport($this->headers, [
        recipeSheetRow(['reference' => $recipe->source_ref, 'ingredient_ref' => 'ING-T01', 'quantity' => 0.2, 'unit' => 'kg']),
        recipeSheetRow(['reference' => $recipe->source_ref, 'ingredient_ref' => 'ING-T02', 'quantity' => 50, 'unit' => 'g']),
    ])->assertOk()->assertJsonPath('data.updated', 1)->assertJsonPath('data.failed', 0);

    $after = recipeSheetLines(recipeSheetVersions($recipe)->sole());

    expect($before[0]->unit_cost_amount)->toBe('0.020000')
        ->and($after[0]->unit_id)->toBe($this->kilograms)
        ->and($after[0]->unit_cost_amount)->not->toBe('0.020000')
        // 0.02 a gram is 20 a kilo — the catalogue's price in the line's new unit.
        ->and((float) $after[0]->unit_cost_amount)->toBe(20.0)
        ->and($after[0]->cost_currency_code)->toBe('USD')
        // The line whose unit did not change keeps its cost exactly.
        ->and($after[1]->unit_cost_amount)->toBe($before[1]->unit_cost_amount);
});

it('fails a group whose Reference matches no recipe, and creates nothing', function (): void {
    recipeSheetImport($this->headers, [
        recipeSheetRow(['reference' => 'RC-9999', 'name_en' => 'Sheet ghost', 'ingredient_ref' => 'ING-T01', 'quantity' => 200, 'unit' => 'g']),
    ])->assertOk()
        ->assertJsonPath('data.failed', 1)
        ->assertJsonPath('data.created', 0)
        ->assertJsonPath('data.rows.0.reference', 'RC-9999')
        ->assertJsonPath('data.rows.0.message', 'No recipe has reference RC-9999.');

    expect(Recipe::withoutTenancy()->where('name_en', 'Sheet ghost')->exists())->toBeFalse();
});

it('keeps the stored quantity when the sheet leaves Quantity blank', function (): void {
    $recipe = recipeSheetHummus($this->headers);

    recipeSheetImport($this->headers, [
        recipeSheetRow(['reference' => $recipe->source_ref, 'ingredient_ref' => 'ING-T01', 'comment' => 'Well stirred']),
        recipeSheetRow(['reference' => $recipe->source_ref, 'ingredient_ref' => 'ING-T02']),
    ])->assertOk()->assertJsonPath('data.updated', 1);

    $lines = recipeSheetLines(recipeSheetVersions($recipe)->sole());

    expect($lines[0]->quantity)->toBe('200.0000')
        ->and($lines[0]->unit_id)->toBe($this->grams)
        ->and($lines[0]->comment)->toBe('Well stirred')
        ->and($lines[1]->quantity)->toBe('50.0000');
});

// ── Export and template ─────────────────────────────────────────────────────

it('exports one row per line, with the cost columns for a reader who may see costs', function (): void {
    $hummus = recipeSheetHummus($this->headers);

    recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet dip', 'ingredient_ref' => 'ING-T03', 'quantity' => 10, 'unit' => 'g']),
    ])->assertOk();

    $sheet = recipeSheetDownload($this->get('/api/v1/catalogue/recipes/export', $this->headers)->assertOk());

    expect($sheet[0])->toBe([...array_values(RecipeSpreadsheetService::HEADERS), 'Version', 'Version status', 'Allergens', 'Line cost', 'Cost currency', 'Updated at'])
        ->and($sheet)->toHaveCount(4)
        ->and(array_slice($sheet[1], 0, 14))->toBe([$hummus->source_ref, 'Sheet hummus', null, null, '2', 'kg', '8', '5', null, 'ING-T01', 'Tahini', '200', 'g', null])
        ->and($sheet[2][9])->toBe('ING-T02')
        ->and($sheet[1][14])->toBe('1')
        ->and($sheet[1][15])->toBe('draft')
        ->and(AuditLog::query()->where('action', 'catalogue.recipes_exported')->count())->toBe(1);
});

it('honours the status filter on export', function (): void {
    $hummus = recipeSheetHummus($this->headers);
    recipeSheetPublish($hummus, 1, $this->headers);

    recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet dip', 'ingredient_ref' => 'ING-T03', 'quantity' => 10, 'unit' => 'g']),
    ])->assertOk();

    $sheet = recipeSheetDownload($this->get('/api/v1/catalogue/recipes/export?status=published', $this->headers)->assertOk());

    expect(array_values(array_unique(array_column(array_slice($sheet, 1), 1))))->toBe(['Sheet hummus']);
});

it('refuses the kind filter on export without catalogue view, and leaves out the cost columns without the cost permission', function (): void {
    $cook = RecipeWorld::kitchen('reader@recipe-sheets.test', ['recipe.view_organisation']);
    $headers = RecipeWorld::headers($cook) + ['Accept' => 'application/json'];
    $this->actingAs($cook->user);

    $this->get('/api/v1/catalogue/recipes/export?kind=sauce', $headers)->assertForbidden();

    $sheet = recipeSheetDownload($this->get('/api/v1/catalogue/recipes/export', $headers)->assertOk());

    expect($sheet[0])->not->toContain('Line cost')
        ->and($sheet[0])->not->toContain('Cost currency')
        ->and($sheet[0])->toContain('Updated at');
});

it('serves the import template: the headers and one example row', function (): void {
    $sheet = recipeSheetDownload($this->get('/api/v1/catalogue/recipes/import-template', $this->headers)->assertOk());

    expect($sheet[0])->toBe(array_values(RecipeSpreadsheetService::HEADERS))
        ->and($sheet[1][0])->toBe('EXAMPLE')
        ->and($sheet)->toHaveCount(2);
});

// ── Batch technical sheets ──────────────────────────────────────────────────

it('refuses more than twenty ids', function (): void {
    $ids = array_map(static fn (): string => (string) Str::uuid(), range(1, 21));

    $this->getJson('/api/v1/catalogue/recipes/technical-sheets?'.http_build_query(['ids' => $ids]), $this->headers)
        ->assertUnprocessable();
});

it('answers each recipe with its versions, its current version and a costed sheet, in the order asked', function (): void {
    $hummus = recipeSheetHummus($this->headers);

    recipeSheetImport($this->headers, [
        recipeSheetRow(['name_en' => 'Sheet dip', 'ingredient_ref' => 'ING-T03', 'quantity' => 10, 'unit' => 'g']),
    ])->assertOk();

    $dip = recipeSheetRecipe('Sheet dip');
    $ids = [(string) $dip->getKey(), (string) Str::uuid(), (string) $hummus->getKey()];

    $response = $this->getJson('/api/v1/catalogue/recipes/technical-sheets?'.http_build_query(['ids' => $ids]), $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data.sheets')
        ->assertJsonPath('data.sheets.0.recipe.id', (string) $dip->getKey())
        ->assertJsonPath('data.sheets.1.recipe.id', (string) $hummus->getKey())
        ->assertJsonPath('data.sheets.1.versions.0.version_number', 1)
        ->assertJsonPath('data.sheets.1.current.version.version_number', 1)
        ->assertJsonPath('data.sheets.1.current.lines.0.ingredient_name_en', 'Tahini')
        ->assertJsonPath('data.sheets.1.current.lines.1.ingredient_name_en', 'Lemon juice');

    expect($response->json('data.sheets.1.current.lines.0'))->toHaveKey('ingredient_name_ar')
        ->and($response->json('data.sheets.1.sheet'))->not->toBeNull()
        ->and($response->json('data.sheets.1.sheet.lines'))->toHaveCount(2)
        ->and(AuditLog::query()->where('action', 'catalogue.technical_sheet_viewed')->count())->toBe(2);
});

it('answers a null sheet, and records no sheet access, for a reader without the cost permission', function (): void {
    $cook = RecipeWorld::kitchen('line-cook@recipe-sheets.test', ['recipe.view_organisation', 'recipe.manage_organisation']);
    $headers = RecipeWorld::headers($cook) + ['Accept' => 'application/json'];
    recipeSheetIngredient($cook, 'Cook tahini', 'ING-K01');
    $this->actingAs($cook->user);

    recipeSheetImport($headers, [
        recipeSheetRow(['name_en' => 'Cook hummus', 'ingredient_ref' => 'ING-K01', 'quantity' => 100, 'unit' => 'g']),
    ])->assertOk()->assertJsonPath('data.created', 1);

    $recipe = recipeSheetRecipe('Cook hummus');

    $this->getJson('/api/v1/catalogue/recipes/technical-sheets?'.http_build_query(['ids' => [(string) $recipe->getKey()]]), $headers)
        ->assertOk()
        ->assertJsonPath('data.sheets.0.sheet', null)
        ->assertJsonPath('data.sheets.0.current.lines.0.ingredient_name_en', 'Cook tahini');

    expect(AuditLog::query()->where('action', 'catalogue.technical_sheet_viewed')->count())->toBe(0);
});
