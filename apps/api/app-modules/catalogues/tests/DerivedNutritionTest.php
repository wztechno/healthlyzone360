<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\DerivedNutritionService;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\RecipeNutritionService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/*
|--------------------------------------------------------------------------
| What one sold unit contains — B5
|--------------------------------------------------------------------------
|
| `DerivedNutritionService::forItem()` answers one question with three
| possible sources, and the order between them is the whole design:
|
|  1. The kitchen's own recorded payload, returned untouched. Somebody
|     measured this dish; a derivation is a calculation about a dish.
|  2. The published recipe version's per-recipe snapshot, divided by the
|     pieces it yields and multiplied by the item's portion factor.
|  3. The same snapshot per 100 g, when the version states a finished mass but
|     no piece count — a bottled sauce or a dressing is sold by weight, has no
|     portion to divide into, and per 100 g is the basis a printed label uses.
|  4. Null — and null for every gap, never a guess. No published version, no
|     snapshot on it, or no finished mass to re-base onto all answer the same
|     way. A piece count is still never invented: `MealExplosion`'s refusal is
|     intact and wins outright where one is stated, and only what its absence
|     falls through *to* has changed.
|
| The last case here is the one that matters most and is easiest to lose: the
| editor's per-100 g tiles and the customer's serving panel are two views of
| one snapshot, and they have to agree on the mass. A 1000 g formulation with
| a stated 800 g yield in four pieces serves 200 g, and the per-100 g a client
| computes from that serving is the per-100 g the editor shows.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('portions@catalogues.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();

    $this->catalogue = Catalogue::factory()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'code' => 'default',
    ]);

    $this->actingAs($this->kitchen->user);
});

/**
 * The seven canonical per-100 g figures, chosen so every division below is
 * exact: 400 g of this ingredient in four pieces is one hundred grams a
 * serving, and a hundred grams of it is the column itself.
 *
 * @return array<string, mixed>
 */
function soldUnitFacts(): array
{
    return RecipeWorld::nutritionEnvelope([
        'energy' => 200, 'protein' => 10, 'carbohydrate' => 20,
        'fat' => 5, 'fibre' => 2, 'sugars' => 1, 'sodium' => 400,
    ]);
}

/**
 * A recipe published through the real publish path, returned as its version.
 *
 * Through HTTP rather than by factory state, because the claim under test is
 * about a *genuine* snapshot: `recipe_versions.nutrition_facts` is written by
 * `RecipeVersionService::publish()`, and a row a factory invented would prove
 * only that this file can divide by four.
 *
 * `$header` is PATCHed onto the version before publication — the yield piece
 * count, and the stated mass yield where a test needs one. Empty leaves the
 * version stating neither, which is one of the refusals.
 *
 * @param  list<array{0: Ingredient, 1: int|string}>  $lines  ingredient and its quantity in grams
 * @param  array<string, mixed>  $header
 */
function publishForSoldUnit(object $kitchen, array $headers, string $grams, array $lines, array $header = [], string $name = 'Tahini Sauce'): RecipeVersion
{
    $recipeId = test()->postJson('/api/v1/catalogue/recipes', ['name_en' => $name], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => array_map(
            static fn (array $line): array => [
                'ingredient_id' => (string) $line[0]->getKey(),
                'quantity' => $line[1],
                'unit_id' => $grams,
            ],
            $lines,
        ),
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    if ($header !== []) {
        test()->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", $header,
            $headers + ['If-Match' => '"1"'])->assertOk();
    }

    // Read the lock back rather than counting writes: how many times the
    // header PATCH bumps it is the version service's business, and a test that
    // guessed would fail for a reason that has nothing to do with nutrition.
    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    test()->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $headers + ['If-Match' => '"'.$version->lock_version.'"'])->assertOk();

    return $version->refresh();
}

/**
 * A published, meal-typed listing in this kitchen's catalogue, read back from
 * the database so its JSON columns have made the round trip a request makes.
 *
 * @param  array<string, mixed>  $attributes
 */
function soldItem(object $context, ?RecipeVersion $version, array $attributes = []): CatalogueItem
{
    // `$attributes` first: PHP's `+` keeps the left operand on a collision, and
    // a caller overriding `recipe_id` is exactly why this takes attributes.
    $item = CatalogueItem::factory()->meal()->published()->create($attributes + [
        'catalogue_id' => $context->catalogue->getKey(),
        'organisation_id' => $context->kitchen->organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $version?->recipe_id,
    ]);

    return CatalogueItem::withoutTenancy()->whereKey($item->getKey())->sole();
}

/**
 * @param  array<string, mixed>  $facts
 * @return array<string, float>
 */
function amountsOf(array $facts): array
{
    $amounts = [];

    foreach ($facts['amounts'] ?? [] as $amount) {
        $amounts[$amount['nutrient_id']] = (float) $amount['value'];
    }

    return $amounts;
}

it('returns the kitchens own recorded payload untouched, whatever the recipe says', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame'),
        soldUnitFacts(),
    );

    $version = publishForSoldUnit($this->kitchen, $this->headers, $this->grams,
        [[$tahini, 400]], ['yield_piece_count' => 4]);

    // A laboratory result, in the shape and with the integer amounts the
    // marketplace read tests assert on literally. Anything that rescaled or
    // re-encoded it would hand `500.0` and `340.0` to those assertions.
    $recorded = [
        'basis' => 'per_serving',
        'kind' => 'planned',
        'serving' => ['label' => '1 bowl', 'quantity' => 1, 'unit' => 'portion', 'grams' => 340, 'millilitres' => null, 'household_measure' => null],
        'total_grams' => 340,
        'amounts' => [['nutrient_id' => 'energy', 'unit' => 'kcal', 'value' => 500, 'kind' => 'planned', 'tolerance' => null]],
        'source' => ['kind' => 'laboratory', 'label' => 'Analysed', 'version' => '1', 'calculated_at' => '2026-01-01T00:00:00+00:00'],
        'calculation' => ['method' => 'laboratory.analysis', 'basis' => 'per_serving', 'calculated_at' => '2026-01-01T00:00:00+00:00', 'prototype' => false, 'rounding' => 'none', 'notes' => []],
    ];

    $item = soldItem($this, $version, ['nutrition_facts' => $recorded]);

    $facts = app(DerivedNutritionService::class)->forItem($item);

    // Every key and every value, nothing added and nothing dropped. `toEqual`
    // rather than `toBe` on the whole payload for one reason only: `jsonb`
    // normalises key order on the way into PostgreSQL, so the array that comes
    // back is the same object written differently. The recipe underneath would
    // have derived 200 kcal on 100 g, and none of it is here.
    expect($facts)->toEqual($recorded);

    // The types, which `toEqual` would not have caught — and they are the
    // whole point of returning the payload untouched. `MarketplaceReadTest`
    // asserts `value === 500` and `grams === 340` on this branch end to end,
    // and a trip through the scaler would hand it `500.0` and `340.0`.
    expect($facts['amounts'][0]['value'])->toBe(500)
        ->and($facts['serving']['grams'])->toBe(340)
        ->and($facts['total_grams'])->toBe(340)
        ->and($facts['source']['kind'])->toBe('laboratory');
});

it('derives one sold unit from the published versions snapshot', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame'),
        soldUnitFacts(),
    );

    // 400 g of a 200 kcal/100 g ingredient is 800 kcal; four pieces is 200.
    $version = publishForSoldUnit($this->kitchen, $this->headers, $this->grams,
        [[$tahini, 400]], ['yield_piece_count' => 4]);

    $facts = app(DerivedNutritionService::class)->forItem(soldItem($this, $version));

    expect($facts)->toBeArray()
        ->and($facts['basis'])->toBe('per_serving')
        ->and($facts['kind'])->toBe('planned')
        ->and($facts['total_grams'])->toEqual(100)
        ->and($facts['calculation']['method'])->toBe('catalogue.nutrition.per_sold_unit')
        ->and($facts['calculation']['basis'])->toBe('per_serving')
        ->and($facts['calculation']['rounding'])->toBe('half_away_from_zero_3dp')

        // Carried through, not rewritten: scaling a figure does not change
        // where it came from, and the mass the snapshot was computed on is
        // still the mass this serving is a fraction of.
        ->and($facts['source']['kind'])->toBe('ingredient_derived')
        ->and($facts['calculation']['notes'])->toBe(['mass_basis: input']);

    expect($facts['serving'])->toBe([
        // Empty rather than "1 portion" — the client's own UNSTATED_SERVING
        // rule. A phrase the kitchen never wrote is worse than none.
        'label' => '',
        'quantity' => 1,
        'unit' => 'portion',
        'grams' => 100.0,
        'millilitres' => null,
        'household_measure' => null,
    ]);

    expect(amountsOf($facts))->toEqual([
        'energy' => 200.0,
        'protein' => 10.0,
        'carbohydrate' => 20.0,
        'fat' => 5.0,
        'fibre' => 2.0,
        'sugars' => 1.0,
        'sodium' => 400.0,
    ]);
});

it('halves every amount and the serving mass for a half-portion listing', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame'),
        soldUnitFacts(),
    );

    $version = publishForSoldUnit($this->kitchen, $this->headers, $this->grams,
        [[$tahini, 400]], ['yield_piece_count' => 4]);

    // The same formulation sold as half a piece — a kids' portion, a side.
    // One sold unit is one yield piece *times the portion factor*, which is
    // the same definition `MealExplosion` deducts stock by.
    $facts = app(DerivedNutritionService::class)->forItem(
        soldItem($this, $version, ['portion_factor' => '0.5']),
    );

    expect($facts)->toBeArray()
        ->and($facts['total_grams'])->toEqual(50)
        ->and($facts['serving']['grams'])->toEqual(50);

    expect(amountsOf($facts))->toEqual([
        'energy' => 100.0,
        'protein' => 5.0,
        'carbohydrate' => 10.0,
        'fat' => 2.5,
        'fibre' => 1.0,
        'sugars' => 0.5,
        'sodium' => 200.0,
    ]);
});

it('says nothing for a listing whose recipe has no published version', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame'),
        soldUnitFacts(),
    );

    // Lines, facts, everything — and still a draft. A formulation nobody has
    // published is not a promise to a diner, and reading figures off one would
    // publish it by the back door.
    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Work In Progress'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $tahini->getKey(), 'quantity' => 400, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $item = soldItem($this, null, ['recipe_id' => $recipeId]);

    expect(app(DerivedNutritionService::class)->forItem($item))->toBeNull();
});

it('falls back to per 100 g when the published version states no piece count', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame'),
        soldUnitFacts(),
    );

    // 800 g of a 200 kcal/100 g ingredient: 1600 kcal in the bottle, 200 in a
    // hundred grams of it. The mass is chosen so the factor is 0.125 rather
    // than 1 — a test whose scaler could be a no-op would pass on a bug.
    $version = publishForSoldUnit($this->kitchen, $this->headers, $this->grams, [[$tahini, 800]]);

    expect($version->nutrition_facts)->not->toBeNull()
        ->and($version->yield_piece_count)->toBeNull();

    $facts = app(DerivedNutritionService::class)->forItem(soldItem($this, $version));

    // The divisor for a *serving* is what is missing, and inventing one is
    // still refused. What the bottle does state is its mass, and per 100 g is
    // the basis its own printed label would use.
    expect($facts)->toBeArray()
        ->and($facts['basis'])->toBe('per_100g')
        ->and($facts['calculation']['method'])->toBe('catalogue.nutrition.per_100g')
        ->and($facts['calculation']['basis'])->toBe('per_100g')
        ->and($facts['calculation']['rounding'])->toBe('half_away_from_zero_3dp')

        // A hundred grams, said on the envelope's face — the amounts below are
        // a hundred grams of this, and nothing has to infer that.
        ->and($facts['total_grams'])->toEqual(100)

        // Null, not an invented portion: the client reads the basis and shows
        // one per-100 g view rather than a serving panel.
        ->and($facts['serving'])->toBeNull()

        // Carried through untouched, as on the per-serving branch.
        ->and($facts['source']['kind'])->toBe('ingredient_derived')
        ->and($facts['calculation']['notes'])->toBe(['mass_basis: input']);

    expect(amountsOf($facts))->toEqual([
        'energy' => 200.0,
        'protein' => 10.0,
        'carbohydrate' => 20.0,
        'fat' => 5.0,
        'fibre' => 2.0,
        'sugars' => 1.0,
        'sodium' => 400.0,
    ]);
});

it('divides by a stated piece count rather than falling back to per 100 g', function (): void {
    // The fallback is for the *absence* of a piece count, never an alternative
    // to one: the same 800 g formulation with four pieces stated is four
    // servings of 200 g, and that is what a customer eats.
    $tahini = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame'),
        soldUnitFacts(),
    );

    $version = publishForSoldUnit($this->kitchen, $this->headers, $this->grams,
        [[$tahini, 800]], ['yield_piece_count' => 4]);

    $facts = app(DerivedNutritionService::class)->forItem(soldItem($this, $version));

    expect($facts)->toBeArray()
        ->and($facts['basis'])->toBe('per_serving')
        ->and($facts['calculation']['method'])->toBe('catalogue.nutrition.per_sold_unit')
        ->and($facts['total_grams'])->toEqual(200)
        ->and($facts['serving']['grams'])->toEqual(200)
        ->and(amountsOf($facts)['energy'])->toEqual(400.0);
});

it('says nothing when the snapshot carries no finished mass', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame'),
        soldUnitFacts(),
    );

    $version = publishForSoldUnit($this->kitchen, $this->headers, $this->grams, [[$tahini, 800]]);

    // Written over rather than published this way, because the publish path
    // cannot produce it: a formulation whose lines resolve always has an input
    // mass, and one whose lines do not withholds the whole snapshot. The
    // refusal still has to exist — `total_grams` is nullable on the envelope,
    // and dividing a hundred grams by nothing is where a silent zero would get
    // in. Encoded by hand because a query-builder update does not run casts.
    $massless = $version->nutrition_facts;
    $massless['total_grams'] = null;

    RecipeVersion::withoutTenancy()->whereKey($version->getKey())->update([
        'nutrition_facts' => json_encode($massless, JSON_THROW_ON_ERROR),
    ]);

    $item = soldItem($this, RecipeVersion::withoutTenancy()->whereKey($version->getKey())->sole());

    expect(app(DerivedNutritionService::class)->forItem($item))->toBeNull();
});

it('says nothing when the published version carries no snapshot', function (): void {
    // An ingredient nobody has recorded facts for withholds the whole label at
    // publication, so the version publishes with `nutrition_facts` null.
    $unmeasured = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');

    $version = publishForSoldUnit($this->kitchen, $this->headers, $this->grams,
        [[$unmeasured, 400]], ['yield_piece_count' => 4]);

    expect($version->nutrition_facts)->toBeNull()
        ->and(app(DerivedNutritionService::class)->forItem(soldItem($this, $version)))->toBeNull();
});

it('agrees with the editors per-100 g figures on the finished mass', function (): void {
    // The reconciliation the whole precision contract exists for. A kilogram
    // of inputs that cooks down to a stated 800 g, sold in four pieces: the
    // customer's serving weighs 200 g, and the per-100 g a client computes
    // from that serving is the per-100 g the editor's tiles show.
    $tahini = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame'),
        soldUnitFacts(),
    );

    $version = publishForSoldUnit($this->kitchen, $this->headers, $this->grams, [[$tahini, 1000]], [
        'yield_quantity' => 800,
        'yield_unit_id' => $this->grams,
        'yield_piece_count' => 4,
    ]);

    $facts = app(DerivedNutritionService::class)->forItem(soldItem($this, $version));

    expect($facts)->toBeArray()
        ->and($facts['serving']['grams'])->toEqual(200)
        ->and($facts['calculation']['notes'])->toBe(['mass_basis: yield']);

    $preview = app(RecipeNutritionService::class)->derive(
        [['ingredient' => $tahini, 'quantity' => '1000', 'unit' => MeasurementUnit::query()->where('code', 'g')->sole()]],
        '800',
        MeasurementUnit::query()->where('code', 'g')->sole(),
    )->per100g();

    expect($preview)->toBeArray();

    $servingAmounts = amountsOf($facts);
    $grams = (float) $facts['serving']['grams'];

    foreach (amountsOf($preview) as $nutrientId => $per100g) {
        // What `format.ts` does client-side: scale the serving back to a
        // hundred grams. The 0.001 tolerance is the transport rounding, not a
        // disagreement — `1 ÷ 3 → 0.333` is not exactly reversible.
        expect($servingAmounts[$nutrientId] / $grams * 100)->toBeGreaterThan($per100g - 0.001)
            ->and($servingAmounts[$nutrientId] / $grams * 100)->toBeLessThan($per100g + 0.001);
    }
});
