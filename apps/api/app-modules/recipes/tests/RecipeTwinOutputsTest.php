<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Procurement\Models\IngredientWeeklyPrice;
use Healthy360\Procurement\Models\WeeklyPricePublication;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;

/*
|--------------------------------------------------------------------------
| A recipe usable as an ingredient has a twin and states its yield (slice F)
|--------------------------------------------------------------------------
|
| A meal's line names an ingredient, so a preparation gets one of its own and
| a sauce uses its listing's; the server states the draft's yield as an output
| of it, whichever of the two arrived first, and never over a row somebody else
| stated. Publication then lets a parent's line be costed from the recipe, and
| the preview says where every line's cost came from (S6).
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('twin-outputs@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->kilograms = RecipeWorld::unit('kg');

    $this->actingAs($this->kitchen->user);

    // Olive oil at a typed 10.00 a kilo, and nothing paid for it.
    $this->oil = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Olive oil');
    $this->oil->default_unit_id = $this->kilograms;
    $this->oil->purchase_unit_id = null;
    $this->oil->purchase_price_amount = '10.000000';
    $this->oil->purchase_price_currency = 'USD';
    $this->oil->save();

    /** A recipe through the API, with 2 kg of oil on version 1 (lock 1). */
    $this->recipe = function (string $name, bool $preparation = false): string {
        $body = ['name_en' => $name] + ($preparation ? ['produces_ingredient' => true] : []);
        $id = (string) $this->postJson('/api/v1/catalogue/recipes', $body, $this->headers)->assertCreated()->json('data.recipe.id');

        $this->putJson("/api/v1/catalogue/recipes/{$id}/versions/1/lines", [
            'lines' => [['ingredient_id' => (string) $this->oil->getKey(), 'quantity' => 2, 'unit_id' => $this->kilograms]],
        ], $this->headers + ['If-Match' => '"0"'])->assertOk();

        return $id;
    };

    /** Version 1's yield, through the API. */
    $this->yield = fn (string $recipeId, int $lock, float $kilograms = 4, float $waste = 10) => $this->patchJson(
        "/api/v1/catalogue/recipes/{$recipeId}/versions/1",
        ['yield_quantity' => $kilograms, 'yield_unit_id' => $this->kilograms, 'waste_coefficient_percent' => $waste],
        $this->headers + ['If-Match' => '"'.$lock.'"'],
    )->assertOk();

    $this->outputsOf = fn (string $recipeId) => RecipeVersionOutput::withoutTenancy()
        ->whereIn('recipe_version_id', RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->select('id'))
        ->get();

    /** The computed lines of a one-kilo draft, through the roll-up preview. */
    $this->previewLines = fn (array $lines): array => $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'lines' => $lines,
        'waste_percent' => 0,
        'yield_quantity' => 1,
        'yield_unit_id' => $this->kilograms,
    ], $this->headers)->assertOk()->json('data.computed_cost.production.lines');
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

it('gives a preparation its own twin, states its yield, and costs a parent line from it once published', function (): void {
    $recipeId = ($this->recipe)('Garlic confit', preparation: true);

    $recipe = Recipe::withoutTenancy()->whereKey($recipeId)->sole();
    $twin = Ingredient::withoutTenancy()->whereKey($recipe->twin_ingredient_id)->sole();

    expect($twin->name_en)->toBe('Garlic confit')
        ->and($twin->default_unit_id)->toBe($this->kilograms)
        ->and($twin->source_ref)->toBe($recipe->source_ref)
        ->and(IngredientCategory::withoutTenancy()->whereKey($twin->ingredient_category_id)->value('code'))->toBe('preparation')
        ->and(($this->outputsOf)($recipeId))->toHaveCount(0);

    // The yield is what a batch makes: 4 kg of the twin, stated without moving the lock.
    ($this->yield)($recipeId, 1)->assertHeader('ETag', '"2"');

    $output = ($this->outputsOf)($recipeId)->sole();

    expect($output->ingredient_id)->toBe((string) $twin->getKey())
        ->and($output->output_quantity)->toBe('4.0000')
        ->and($output->unit_id)->toBe($this->kilograms)
        ->and($output->is_primary)->toBeTrue()
        ->and($output->follows_yield)->toBeTrue();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [], $this->headers + ['If-Match' => '"2"'])
        ->assertOk()
        ->assertJsonPath('data.version.status', 'published');

    // Nobody typed a price on the twin: the parent's line is costed from the recipe that makes it.
    // 2 kg at 10.00 makes 4 kg — 5.00 a kilo, 5.50 with the confit's own 10% waste.
    expect($twin->refresh()->purchase_price_amount)->toBeNull();

    $line = ($this->previewLines)([['ingredient_id' => (string) $twin->getKey(), 'quantity' => 1, 'unit_id' => $this->kilograms]])[0];

    expect($line['cost_source'])->toBe('component_recipe')
        ->and($line['unit_cost_amount'])->toBe('5.500000')
        ->and($line['source_recipe'])->toBe(['id' => $recipeId, 'name_en' => 'Garlic confit', 'name_ar' => '']);
});

it('creates no twin for a recipe made without the flag', function (): void {
    $recipeId = ($this->recipe)('Tahini sauce');

    ($this->yield)($recipeId, 1);

    expect(Recipe::withoutTenancy()->whereKey($recipeId)->sole()->twin_ingredient_id)->toBeNull()
        ->and(($this->outputsOf)($recipeId))->toHaveCount(0);
});

it('states a sauce recipe\'s yield for the twin of a sauce created after it', function (): void {
    // The new-sauce flow: the recipe first, its yield saved, and the item last.
    $recipeId = ($this->recipe)('Garlic sauce');
    ($this->yield)($recipeId, 1, 2);

    expect(($this->outputsOf)($recipeId))->toHaveCount(0);

    $item = $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'sauce',
        'name_en' => 'Garlic Sauce',
        'recipe_id' => $recipeId,
    ], $this->headers)->assertCreated()->json('data.item');

    $output = ($this->outputsOf)($recipeId)->sole();

    expect($output->ingredient_id)->toBe($item['ingredient_id'])
        ->and($output->output_quantity)->toBe('2.0000')
        ->and($output->follows_yield)->toBeTrue();
});

it('states the yield of a sauce linked first and given its yield after', function (): void {
    $item = $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'sauce',
        'name_en' => 'Chilli Sauce',
    ], $this->headers)->assertCreated()->json('data.item');

    $recipeId = ($this->recipe)('Chilli sauce');

    $this->patchJson('/api/v1/catalogue/items/'.$item['id'], ['recipe_id' => $recipeId], $this->headers + ['If-Match' => '"0"'])
        ->assertOk();

    // Linked, but no yield yet: nothing to state.
    expect(($this->outputsOf)($recipeId))->toHaveCount(0);

    ($this->yield)($recipeId, 1, 3);

    $output = ($this->outputsOf)($recipeId)->sole();

    expect($output->ingredient_id)->toBe($item['ingredient_id'])
        ->and($output->output_quantity)->toBe('3.0000');

    // A changed yield moves the server's row with it.
    ($this->yield)($recipeId, 2, 5);

    expect(($this->outputsOf)($recipeId)->sole()->output_quantity)->toBe('5.0000');
});

it('leaves an output row somebody stated exactly as it was', function (): void {
    $recipeId = ($this->recipe)('Pesto base', preparation: true);
    $recipe = Recipe::withoutTenancy()->whereKey($recipeId)->sole();
    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    // The importer's row: the sheet says a batch makes 3 kg, whatever it weighs.
    RecipeVersionOutput::withoutTenancy()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'ingredient_id' => $recipe->twin_ingredient_id,
        'output_quantity' => '3',
        'unit_id' => $this->kilograms,
        'is_primary' => true,
    ]);

    ($this->yield)($recipeId, 1, 2);

    $output = ($this->outputsOf)($recipeId)->sole();

    expect($output->output_quantity)->toBe('3.0000')
        ->and($output->follows_yield)->toBeFalse();
});

it('says where each preview line\'s cost came from: paid, typed or quoted', function (): void {
    // Paid: a published weekly price of 4.00 a kilo for flour.
    $flour = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Flour');
    $flour->default_unit_id = $this->kilograms;
    $flour->purchase_price_amount = null;
    $flour->purchase_price_currency = null;
    $flour->save();

    $publication = WeeklyPricePublication::query()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'purchase_week_start_date' => '2026-08-31',
        'purchase_week_end_date' => '2026-09-06',
        'effective_from_date' => '2026-09-07',
        'timezone' => 'Asia/Beirut',
        'published_at' => now(),
        'ingredient_count' => 1,
        'computed_count' => 1,
    ]);

    IngredientWeeklyPrice::query()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'weekly_price_publication_id' => $publication->getKey(),
        'ingredient_id' => $flour->getKey(),
        'purchase_week_start_date' => $publication->purchase_week_start_date,
        'purchase_week_end_date' => $publication->purchase_week_end_date,
        'effective_from_date' => $publication->effective_from_date,
        'unit_id' => $this->kilograms,
        'average_unit_amount' => '4.000000',
        'currency_code' => 'USD',
        'total_quantity' => '10',
        'total_cost_amount' => '10',
        'receipt_line_count' => 1,
        'source' => 'computed',
        'carried_from_week_start_date' => null,
    ]);

    // Typed: a preparation whose recipe is still a draft falls back to its twin's typed price (S6).
    $recipeId = ($this->recipe)('Harissa base', preparation: true);
    ($this->yield)($recipeId, 1, 2);
    $twin = Ingredient::withoutTenancy()->whereKey(Recipe::withoutTenancy()->whereKey($recipeId)->value('twin_ingredient_id'))->sole();
    $twin->purchase_price_amount = '7.000000';
    $twin->purchase_price_currency = 'USD';
    $twin->save();

    $lines = ($this->previewLines)([
        ['ingredient_id' => (string) $flour->getKey(), 'quantity' => 1, 'unit_id' => $this->kilograms],
        ['ingredient_id' => (string) $twin->getKey(), 'quantity' => 1, 'unit_id' => $this->kilograms],
        ['ingredient_id' => (string) $this->oil->getKey(), 'quantity' => 1, 'unit_id' => $this->kilograms, 'unit_cost_amount' => 9.5, 'cost_currency_code' => 'USD'],
    ]);

    expect(array_column($lines, 'cost_source'))->toBe(['weekly', 'ingredient_fallback', 'quoted'])
        ->and($lines[0]['unit_cost_amount'])->toBe('4.000000')
        ->and($lines[1]['unit_cost_amount'])->toBe('7.000000')
        ->and((float) $lines[2]['unit_cost_amount'])->toBe(9.5)
        ->and(array_column($lines, 'source_recipe'))->toBe([null, null, null]);
});

it('names the recipe that makes each ingredient on the list, in one query for the page', function (): void {
    $recipeId = ($this->recipe)('Garlic confit', preparation: true);
    ($this->yield)($recipeId, 1);
    $twinId = (string) Recipe::withoutTenancy()->whereKey($recipeId)->value('twin_ingredient_id');

    $rows = collect($this->getJson('/api/v1/catalogue/ingredients', $this->headers)->assertOk()->json('data'))
        ->keyBy('id');

    expect($rows[$twinId]['produced_by_recipe'])->toBe([
        'id' => $recipeId,
        'name_en' => 'Garlic confit',
        'name_ar' => '',
        'is_published' => false,
    ])->and($rows[(string) $this->oil->getKey()]['produced_by_recipe'])->toBeNull();

    // The port answers a page in one statement, however many rows are on it.
    $organisationId = (string) $this->kitchen->organisation->getKey();
    app(TenantContext::class)->setOrganisation((string) $this->kitchen->user->getKey(), $organisationId);
    app(DatabaseTenantContext::class)->apply(null, $organisationId, null);

    $queries = function (array $ids): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        app(IngredientUsageRegistry::class)->producedByRecipes($ids);
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    };

    $others = Ingredient::factory()->count(3)->create(['organisation_id' => $organisationId]);

    expect($queries([$twinId]))->toBe(1)
        ->and($queries([$twinId, ...$others->map(static fn (Ingredient $row): string => (string) $row->getKey())->all()]))->toBe(1);
});

it('publishes even when refreshing what its sellers earn fails, and reports the failure', function (): void {
    $recipeId = ($this->recipe)('Lemon dressing');
    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    // Every other question answered as the null registry would; only the refresh fails.
    $usage = Mockery::mock(RecipeUsageRegistry::class);
    $usage->shouldReceive('sellingBlockers', 'publishedItemIds', 'quarantinePublishedItems', 'releaseQuarantinedItems', 'sellersByRecipe')->andReturn([]);
    $usage->shouldReceive('constrainBySellers', 'orWhereSellerMatches', 'twinIngredientId')->andReturnNull();
    $usage->shouldReceive('recipePublished')->once()->andThrow(new RuntimeException('Simulated margins failure'));
    app()->instance(RecipeUsageRegistry::class, $usage);

    Exceptions::fake();

    $organisationId = (string) $this->kitchen->organisation->getKey();
    app(TenantContext::class)->setOrganisation((string) $this->kitchen->user->getKey(), $organisationId);
    app(DatabaseTenantContext::class)->apply(null, $organisationId, null);

    $published = app(RecipeVersionService::class)->publish($version, $version->lock_version);

    expect($published->status)->toBe(RecipeVersionStatus::Published)
        ->and($version->refresh()->status)->toBe(RecipeVersionStatus::Published);

    Exceptions::assertReported(RuntimeException::class);
});
