<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\PackagingBasis;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Packaging on a recipe version, and the cost block it completes
|--------------------------------------------------------------------------
|
| The source workbook runs two identical tables down one page — raw materials,
| then packaging — each summing `quantity × unit price`, each dividing its
| total by the *same* yield, and each applying its own waste coefficient. The
| bottom line adds the two per-unit figures together.
|
| The headline test below reproduces that page digit for digit from the API,
| which is the strongest statement available that this implementation computes
| what the kitchen already computes by hand.
|
| The tests after it cover the one place this deliberately departs from the
| workbook: the workbook types every packaging quantity, and its "Bottle 300"
| therefore reads `1` against a 1.7 kg batch — a figure that was right for some
| earlier batch size and was never revisited. Two of the three bases here
| compute the number instead, so it cannot go stale unnoticed.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('chef@packaging-cost.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->kilograms = RecipeWorld::unit('kg');

    $this->actingAs($this->kitchen->user);
});

/**
 * A recipe yielding 1.7 kg whose formulation totals 7.186 — the workbook's
 * "Thousand Islands" sheet, as one line rather than nine.
 *
 * The nine lines are not the point of these tests; the block that divides
 * their total is. One line carrying the same total exercises exactly the same
 * arithmetic downstream and leaves the assertions about the packaging block
 * rather than about a sum that `RecipeCostingTest` already covers.
 *
 * @return array{0: string, 1: int} the recipe id, and the lock version to
 *                                  send with the next write
 */
function thousandIslands(object $kitchen, array $headers, string $kilograms): array
{
    $ingredient = RecipeWorld::mappedIngredient($kitchen->organisation, 'Mayonnaise '.uniqid(), 'egg');

    $recipeId = test()->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Thousand Islands'], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    test()->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", [
        'yield_quantity' => '1.7',
        'yield_unit_id' => $kilograms,
        'waste_coefficient_percent' => '3',
        'packaging_waste_percent' => '5',
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => 1,
            'unit_id' => $kilograms,
            'unit_cost_amount' => '7.186',
            'cost_currency_code' => 'USD',
        ]],
    ], $headers + ['If-Match' => '"1"'])->assertOk();

    return [$recipeId, 2];
}

it('costs a line from the ingredient catalogue when the caller quotes no price', function (): void {
    /*
     * The defect this covers: the recipe editor writes lines with no cost on them — it sends the
     * ingredient, the quantity and the unit, which is everything a formulation is — and nothing
     * filled the gap. Every line the product had ever written was uncosted, so a kitchen could
     * price its whole catalogue and still see no recipe cost anywhere, with nothing on screen to
     * say why. The packaging path never had the problem because it reads the item's price at write
     * time; this is that same rule for the formulation.
     */
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Mayonnaise', 'egg');
    $ingredient->default_unit_id = $this->kilograms;
    $ingredient->purchase_unit_id = $this->kilograms;
    $ingredient->purchase_price_amount = '3.5';
    $ingredient->purchase_price_currency = 'USD';
    $ingredient->save();

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Costed From Catalogue'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", [
        'yield_quantity' => '1', 'yield_unit_id' => $this->kilograms,
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    // No `unit_cost_amount` and no `cost_currency_code` — exactly what the editor sends.
    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => 2,
            'unit_id' => $this->kilograms,
        ]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    $line = RecipeVersionLine::withoutTenancy()->sole();

    expect((string) $line->unit_cost_amount)->toBe('3.500000')
        ->and((string) $line->line_cost_amount)->toBe('7.000000')
        ->and($line->cost_currency_code)->toBe('USD');
});

it('converts a catalogue price within a dimension, exactly', function (): void {
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Akkawi cheese', 'milk');
    $ingredient->default_unit_id = $this->kilograms;
    $ingredient->purchase_unit_id = $this->kilograms;
    $ingredient->purchase_price_amount = '7.88';
    $ingredient->purchase_price_currency = 'USD';
    $ingredient->save();

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Grams Of A Kilo'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", [
        'yield_quantity' => '1', 'yield_unit_id' => $this->kilograms,
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    // Priced per kilogram, written in grams — which is how most formulations are
    // actually written, and which used to leave the line uncosted.
    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => 250,
            'unit_id' => RecipeWorld::unit('g'),
        ]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    $line = RecipeVersionLine::withoutTenancy()->sole();

    /*
     * 7.88 per kg is 0.00788 per g exactly — `base_ratio` states that kg is a thousand of the
     * mass dimension's base and g is one, so the conversion is arithmetic rather than a guess.
     * 250 g is therefore 1.97, which is the figure a person checks with a calculator.
     */
    expect((string) $line->unit_cost_amount)->toBe('0.007880')
        ->and((string) $line->line_cost_amount)->toBe('1.970000')
        ->and($line->cost_currency_code)->toBe('USD');
});

it('refuses to convert across dimensions, and leaves the line uncosted', function (): void {
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Lemon', 'egg');
    $ingredient->default_unit_id = RecipeWorld::unit('piece');
    $ingredient->purchase_unit_id = RecipeWorld::unit('piece');
    $ingredient->purchase_price_amount = '0.60';
    $ingredient->purchase_price_currency = 'USD';
    $ingredient->save();

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Pieces Into Kilos'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", [
        'yield_quantity' => '1', 'yield_unit_id' => $this->kilograms,
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => '0.5',
            'unit_id' => $this->kilograms,
        ]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    /*
     * Priced per piece, written in kilograms. Nothing in the reference data relates `count` to
     * `mass`, and the factor that would — a piece of *this* ingredient weighing *this* much — is
     * not something this system records. So the line stays uncosted and the sheet says which one
     * to go and look at, rather than inventing a lemon's weight.
     */
    $line = RecipeVersionLine::withoutTenancy()->sole();

    expect($line->unit_cost_amount)->toBeNull()
        ->and($line->cost_currency_code)->toBeNull();
});

it('does not overwrite a cost the caller stated', function (): void {
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Salt', 'egg');
    $ingredient->default_unit_id = $this->kilograms;
    $ingredient->purchase_unit_id = $this->kilograms;
    $ingredient->purchase_price_amount = '0.30';
    $ingredient->purchase_price_currency = 'USD';
    $ingredient->save();

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Quoted Cost'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => 1,
            'unit_id' => $this->kilograms,
            'unit_cost_amount' => '0.45',
            'cost_currency_code' => 'USD',
        ]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    /*
     * The importer records what a source sheet said, errors included, and a fallback that overrode
     * it would replace a transcription with a guess at what it should have been. A stated cost
     * always wins.
     */
    expect((string) RecipeVersionLine::withoutTenancy()->sole()->unit_cost_amount)->toBe('0.450000');
});

it('reproduces the source workbook cost block, digit for digit', function (): void {
    [$recipeId, $lock] = thousandIslands($this->kitchen, $this->headers, $this->kilograms);

    // The workbook's own two packaging rows, at its own quantities. `per_batch`
    // because that is what the sheet is actually asserting — one bottle and one
    // cap per run — and reproducing the sheet means reproducing its inputs, not
    // improving on them. The next test is where the improvement is tested.
    $bottle = RecipeWorld::packagingItem($this->kitchen->organisation, 'Bottle 300', '0.25');
    $cap = RecipeWorld::packagingItem($this->kitchen->organisation, 'Cap', '0.10');

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [
            ['ingredient_id' => (string) $bottle->getKey(), 'basis' => 'per_batch', 'quantity' => 1],
            ['ingredient_id' => (string) $cap->getKey(), 'basis' => 'per_batch', 'quantity' => 1],
        ],
    ], $this->headers + ['If-Match' => '"'.$lock.'"'])->assertOk();

    $sheet = $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/technical-sheet", $this->headers)
        ->assertOk();

    /*
     * Cell for cell against the workbook:
     *
     *   E23  total production          7.186
     *   B26  = B25 / B8                7.186 / 1.7   = 4.227059
     *   B27  = B26 * 1.03                            = 4.353871
     *   E33  total packaging           0.25 + 0.10   = 0.35
     *   B36  = B35 / B8                0.35 / 1.7    = 0.205882
     *   B37  = B36 * 1.05                            = 0.216176
     *   B39  = B27 + B37                             = 4.570047
     *
     * The last figure is the one this whole slice exists to produce, and it
     * agrees with the spreadsheet to the sixth place.
     */
    expect($sheet->json('data.computed.production.total_input_cost_amount'))->toBe('7.186000')
        ->and($sheet->json('data.computed.production.cost_per_yield_unit_amount'))->toBe('4.227059')
        ->and($sheet->json('data.computed.production.cost_per_yield_unit_with_waste_amount'))->toBe('4.353871')
        ->and($sheet->json('data.computed.packaging.total_packaging_cost_amount'))->toBe('0.350000')
        ->and($sheet->json('data.computed.packaging.cost_per_yield_unit_amount'))->toBe('0.205882')
        ->and($sheet->json('data.computed.packaging.cost_per_yield_unit_with_waste_amount'))->toBe('0.216176')
        ->and($sheet->json('data.computed.total_cost_per_yield_unit_amount'))->toBe('4.570047')

        // The two coefficients are different numbers on one sheet, which is
        // why they are two columns rather than one.
        ->and($sheet->json('data.computed.production.waste_percent'))->toBe('3.00')
        ->and($sheet->json('data.computed.packaging.waste_percent'))->toBe('5.00');
});

it('works out how many containers the yield fills, and follows them with the caps', function (): void {
    [$recipeId, $lock] = thousandIslands($this->kitchen, $this->headers, $this->kilograms);

    // 0.3 kg of product per bottle. Recorded as a weight and not as "300 ml",
    // because the yield it will be divided into is a weight and converting
    // between the two would need a density nothing here stores.
    $bottle = RecipeWorld::packagingItem($this->kitchen->organisation, 'Bottle 300', '0.25', capacity: '0.3');
    $cap = RecipeWorld::packagingItem($this->kitchen->organisation, 'Cap', '0.10');

    $response = test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [
            ['ingredient_id' => (string) $bottle->getKey(), 'basis' => 'fills_yield'],
            ['ingredient_id' => (string) $cap->getKey(), 'basis' => 'per_container'],
        ],
    ], $this->headers + ['If-Match' => '"'.$lock.'"'])->assertOk();

    /*
     * 1.7 / 0.3 is 5.67, so six bottles — and six caps, because a cap is one
     * per bottle rather than one per batch.
     *
     * This is the number the workbook gets wrong. Its sheet says `1` bottle
     * against the same 1.7 kg, which was presumably right at some earlier batch
     * size and silently stopped being right. Deriving it is the whole point of
     * the basis column.
     */
    expect($response->json('data.packaging.0.quantity'))->toBe('6.0000')
        ->and($response->json('data.packaging.1.quantity'))->toBe('6.0000');

    // 6 × 0.25 + 6 × 0.10 = 2.10, over the same 1.7 kg yield, then +5 %.
    $sheet = $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/technical-sheet", $this->headers)
        ->assertOk();

    expect($sheet->json('data.computed.packaging.total_packaging_cost_amount'))->toBe('2.100000')
        ->and($sheet->json('data.computed.packaging.cost_per_yield_unit_amount'))->toBe('1.235294')
        ->and($sheet->json('data.computed.packaging.cost_per_yield_unit_with_waste_amount'))->toBe('1.297059');
});

it('rounds the container count up, because two thirds of a bottle holds nothing', function (): void {
    [$recipeId, $lock] = thousandIslands($this->kitchen, $this->headers, $this->kilograms);

    $bottle = RecipeWorld::packagingItem($this->kitchen->organisation, 'Bottle 500', '0.40', capacity: '0.5');

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [['ingredient_id' => (string) $bottle->getKey(), 'basis' => 'fills_yield']],
    ], $this->headers + ['If-Match' => '"'.$lock.'"'])->assertOk();

    // 1.7 / 0.5 is 3.4. Four bottles, not three: the fourth is two-fifths full
    // and is still a bottle somebody bought. Rounding down would understate the
    // cost by exactly the container the batch will not fit into.
    $row = RecipeVersionPackaging::withoutTenancy()->sole();

    expect((string) $row->quantity)->toBe('4.0000')
        ->and($row->basis)->toBe(PackagingBasis::FillsYield);
});

it('recomputes the container count when the yield changes, without anybody re-typing it', function (): void {
    [$recipeId, $lock] = thousandIslands($this->kitchen, $this->headers, $this->kilograms);

    $bottle = RecipeWorld::packagingItem($this->kitchen->organisation, 'Bottle 300', '0.25', capacity: '0.3');

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [['ingredient_id' => (string) $bottle->getKey(), 'basis' => 'fills_yield']],
    ], $this->headers + ['If-Match' => '"'.$lock.'"'])->assertOk();

    expect((string) RecipeVersionPackaging::withoutTenancy()->sole()->quantity)->toBe('6.0000');

    // The batch doubles.
    test()->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", [
        'yield_quantity' => '3.4',
    ], $this->headers + ['If-Match' => '"'.($lock + 1).'"'])->assertOk();

    /*
     * The stored figure does not move on its own, and that is the design: a
     * technical sheet is a document, and a document whose numbers change when
     * you open it is not one. The next write to the set is what re-derives
     * them — deliberately, and with somebody looking.
     */
    expect((string) RecipeVersionPackaging::withoutTenancy()->sole()->quantity)->toBe('6.0000');

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [['ingredient_id' => (string) $bottle->getKey(), 'basis' => 'fills_yield']],
    ], $this->headers + ['If-Match' => '"'.($lock + 2).'"'])->assertOk();

    // 3.4 / 0.3 is 11.33, so twelve.
    expect((string) RecipeVersionPackaging::withoutTenancy()->sole()->quantity)->toBe('12.0000');
});

it('refuses a container the version has no yield to fill, and one that says nothing about what it holds', function (): void {
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Mayonnaise', 'egg');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Yieldless'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $capacious = RecipeWorld::packagingItem($this->kitchen->organisation, 'Bottle', '0.25', capacity: '0.3');

    // No yield on the version: there is nothing for a container to be filled
    // from. Refused rather than defaulted to one container, because a default
    // would put a plausible figure on the sheet that nobody measured and that
    // nobody could later tell apart from one that was.
    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [['ingredient_id' => (string) $capacious->getKey(), 'basis' => 'fills_yield']],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['packaging.0.basis']]]]);

    $this->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", [
        'yield_quantity' => '1.7', 'yield_unit_id' => $this->kilograms,
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $ingredient->getKey(), 'quantity' => 1, 'unit_id' => $this->kilograms]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    // Now the yield exists but the item states no capacity — the other half of
    // the same division, and refused for the same reason.
    $capacityless = RecipeWorld::packagingItem($this->kitchen->organisation, 'Mystery Tub', '0.25');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [['ingredient_id' => (string) $capacityless->getKey(), 'basis' => 'fills_yield']],
    ], $this->headers + ['If-Match' => '"2"'])
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['packaging.0.ingredient_id']]]]);
});

it('refuses a per-container line on a version with no containers', function (): void {
    [$recipeId, $lock] = thousandIslands($this->kitchen, $this->headers, $this->kilograms);

    $cap = RecipeWorld::packagingItem($this->kitchen->organisation, 'Cap', '0.10');

    // Costing this as zero would hide the real mistake, which is that the
    // bottle the cap goes on is missing from the list.
    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [['ingredient_id' => (string) $cap->getKey(), 'basis' => 'per_container']],
    ], $this->headers + ['If-Match' => '"'.$lock.'"'])
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['packaging.0.basis']]]]);
});

it('refuses a typed quantity on a basis that works its own out', function (): void {
    [$recipeId, $lock] = thousandIslands($this->kitchen, $this->headers, $this->kilograms);

    $bottle = RecipeWorld::packagingItem($this->kitchen->organisation, 'Bottle 300', '0.25', capacity: '0.3');

    /*
     * Told, not silently corrected.
     *
     * A request that accepted the `2` and then stored `6` would be the same
     * defect this whole piece of work began by fixing one family over: a field
     * that looks like it works, takes what you type and discards it.
     */
    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [[
            'ingredient_id' => (string) $bottle->getKey(),
            'basis' => 'fills_yield',
            'quantity' => 2,
        ]],
    ], $this->headers + ['If-Match' => '"'.$lock.'"'])
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['packaging.0.quantity']]]]);
});

it('divides a pack price by the pieces in the pack', function (): void {
    [$recipeId, $lock] = thousandIslands($this->kitchen, $this->headers, $this->kilograms);

    // A case of 500 lids at 40.00. A recipe consumes lids, not cases, so the
    // unit cost stored on the line is 0.08 — the price over `items_per_unit`.
    $lids = RecipeWorld::packagingItem($this->kitchen->organisation, 'Lid, case of 500', '40.00');
    $lids->items_per_unit = '500';
    $lids->save();

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [['ingredient_id' => (string) $lids->getKey(), 'basis' => 'per_batch', 'quantity' => 10]],
    ], $this->headers + ['If-Match' => '"'.$lock.'"'])->assertOk();

    $row = RecipeVersionPackaging::withoutTenancy()->sole();

    expect((string) $row->unit_cost_amount)->toBe('0.080000')

        // Derived through the same `lineCost()` the formulation uses, so a
        // packaging total and a raw-material total are one arithmetic.
        ->and((string) $row->line_cost_amount)->toBe('0.800000');
});

it('leaves an unpriced box uncosted rather than totalling it as free', function (): void {
    [$recipeId, $lock] = thousandIslands($this->kitchen, $this->headers, $this->kilograms);

    $priced = RecipeWorld::packagingItem($this->kitchen->organisation, 'Bottle', '0.25');
    $unpriced = RecipeWorld::packagingItem($this->kitchen->organisation, 'Sleeve', '0.10');
    $unpriced->purchase_price_amount = null;
    $unpriced->purchase_price_currency = null;
    $unpriced->save();

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [
            ['ingredient_id' => (string) $priced->getKey(), 'basis' => 'per_batch', 'quantity' => 1],
            ['ingredient_id' => (string) $unpriced->getKey(), 'basis' => 'per_batch', 'quantity' => 1],
        ],
    ], $this->headers + ['If-Match' => '"'.$lock.'"'])->assertOk();

    $sheet = $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/technical-sheet", $this->headers)
        ->assertOk();

    /*
     * The partial total is still reported — a kitchen pricing a sheet over a
     * week wants to see where it has got to — but the *combined* figure is
     * withheld, because a total short by whatever nobody has priced reads
     * exactly like a complete one. The uncosted list beside it says which line
     * to go and look at.
     */
    expect($sheet->json('data.computed.packaging.uncosted_line_numbers'))->toBe([2])
        ->and($sheet->json('data.computed.packaging.is_complete'))->toBeFalse()
        ->and($sheet->json('data.computed.packaging.total_packaging_cost_amount'))->toBe('0.250000')
        ->and($sheet->json('data.computed.total_cost_per_yield_unit_amount'))->toBeNull();
});

it('carries the packaging over when a new draft is opened from a published version', function (): void {
    [$recipeId, $lock] = thousandIslands($this->kitchen, $this->headers, $this->kilograms);

    $bottle = RecipeWorld::packagingItem($this->kitchen->organisation, 'Bottle 300', '0.25', capacity: '0.3');

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/packaging", [
        'packaging' => [['ingredient_id' => (string) $bottle->getKey(), 'basis' => 'fills_yield']],
    ], $this->headers + ['If-Match' => '"'.$lock.'"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions", ['copy_from_version' => 1], $this->headers)
        ->assertCreated();

    $rows = RecipeVersionPackaging::withoutTenancy()->orderBy('recipe_version_id')->get();

    /*
     * Copied with its stored quantity rather than re-derived against the new
     * draft. The draft's yield is the old one's, so the two agree by
     * construction — and recomputing here would make a copy differ from its
     * source the moment somebody had edited the bottle's capacity since, which
     * is exactly the history-rewriting this table stores its costs to avoid.
     */
    expect($rows)->toHaveCount(2)
        ->and($rows->pluck('quantity')->map(static fn ($value): string => (string) $value)->unique()->all())
        ->toBe(['6.0000']);
});
