<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Kitchens\Import\Runtime\BackfillStub;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| kitchen:formulate-unlinked
|--------------------------------------------------------------------------
|
| Every meal, sauce, dressing and frozen meal with no recipe gets a placeholder
| draft, so the recipe book can list the whole kitchen; `--check` fails while
| any is left; `--undo` deletes the placeholders nobody has touched.
|
| What has to hold: the run and the check read one predicate; the item a
| placeholder is linked to keeps its validator, status and flags; nothing is
| written twice, or at all on a dry run; and the undo — the first hard delete of
| a recipe anywhere — never takes a recipe somebody has worked on.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    config()->set('kitchens.import.environments', ['local', 'testing']);

    $this->kitchen = CatalogueWorld::kitchen('formulate@kitchen.test');
    $this->other = CatalogueWorld::kitchen('formulate-elsewhere@kitchen.test');
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

/**
 * @param  array<string, mixed>  $attributes
 */
function formulateItem(object $tenant, CatalogueItemType $type, string $slug, array $attributes = []): CatalogueItem
{
    return CatalogueItem::factory()->create([
        'catalogue_id' => $tenant->catalogue->getKey(),
        'organisation_id' => $tenant->organisation->getKey(),
        'item_type' => $type,
        'slug' => $slug,
        'name_en' => ucfirst(str_replace('-', ' ', $slug)),
    ] + $attributes);
}

/**
 * @param  array<string, mixed>  $options
 */
function runFormulate(object $tenant, array $options = []): int
{
    return test()->artisan('kitchen:formulate-unlinked', ['--org' => $tenant->organisation->slug] + $options)->run();
}

function formulatedRecipeId(CatalogueItem $item): ?string
{
    $recipeId = CatalogueItem::withoutTenancy()->whereKey($item->getKey())->value('recipe_id');

    return is_string($recipeId) ? $recipeId : null;
}

it('gives every recipe-less meal, sauce, dressing and frozen meal a placeholder draft', function (): void {
    $items = [
        formulateItem($this->kitchen, CatalogueItemType::Meal, 'grilled-chicken', [
            'name_ar' => 'دجاج مشوي',
            'description_en' => 'Char-grilled, with sumac onions.',
        ]),
        formulateItem($this->kitchen, CatalogueItemType::Sauce, 'garlic-mayo'),
        formulateItem($this->kitchen, CatalogueItemType::Dressing, 'lemon-dressing'),
        formulateItem($this->kitchen, CatalogueItemType::FrozenMeal, 'frozen-lasagne'),
        // Bought in, and still a sauce the recipe book has to be able to show.
        formulateItem($this->kitchen, CatalogueItemType::Sauce, 'bought-in-sriracha', ['production_mode' => ProductionMode::Supplier]),
    ];

    expect(runFormulate($this->kitchen))->toBe(0);

    foreach ($items as $item) {
        $recipeId = formulatedRecipeId($item);

        expect($recipeId)->not->toBeNull($item->slug);

        $recipe = Recipe::withoutTenancy()->whereKey($recipeId)->sole();
        $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

        // A name and nothing behind it: no yield, no lines, a draft nobody published — and
        // `current`, so the review queue does not gain a row per placeholder.
        expect($recipe->source_system)->toBe(BackfillStub::SOURCE_SYSTEM)
            ->and($recipe->organisation_id)->toBe((string) $this->kitchen->organisation->getKey())
            ->and($recipe->name_en)->toBe($item->name_en)
            ->and($recipe->source_ref)->toStartWith('RC-')
            ->and($version->status)->toBe(RecipeVersionStatus::Draft)
            ->and($version->derivation_state)->toBe(DerivationState::Current)
            ->and($version->yield_quantity)->toBeNull()
            ->and(RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $version->getKey())->count())->toBe(0);
    }

    $chicken = Recipe::withoutTenancy()->whereKey(formulatedRecipeId($items[0]))->sole();

    expect($chicken->name_ar)->toBe('دجاج مشوي')
        ->and($chicken->notes)->toBe('Char-grilled, with sumac onions.')
        ->and(AuditLog::query()->where('action', 'catalogue.item_recipe_backfilled')->count())->toBe(5);
});

it('leaves retired, linked and non-cooked items alone, and nothing else on the ones it links', function (): void {
    $live = formulateItem($this->kitchen, CatalogueItemType::Meal, 'live-plate', [
        'status' => CatalogueItemStatus::Published,
        'lock_version' => 4,
        'data_quality_flags' => ['recipe_library_unlinked', 'missing_b2b_price'],
    ]);

    $retired = formulateItem($this->kitchen, CatalogueItemType::Sauce, 'withdrawn-sauce', ['status' => CatalogueItemStatus::Retired]);
    $existing = Recipe::factory()->create(['organisation_id' => $this->kitchen->organisation->getKey()]);
    $linked = formulateItem($this->kitchen, CatalogueItemType::Sauce, 'linked-sauce', ['recipe_id' => $existing->getKey()]);
    $product = formulateItem($this->kitchen, CatalogueItemType::Product, 'resold-water');
    $plan = formulateItem($this->kitchen, CatalogueItemType::SubscriptionPlan, 'weekly-plan');

    // Another kitchen's recipe-less meal is not this run's business.
    $theirs = formulateItem($this->other, CatalogueItemType::Meal, 'their-plate');

    $recipesBefore = Recipe::withoutTenancy()->count();

    expect(runFormulate($this->kitchen))->toBe(0);

    expect(formulatedRecipeId($retired))->toBeNull()
        ->and(formulatedRecipeId($linked))->toBe((string) $existing->getKey())
        ->and(formulatedRecipeId($product))->toBeNull()
        ->and(formulatedRecipeId($plan))->toBeNull()
        ->and(formulatedRecipeId($theirs))->toBeNull()
        ->and(Recipe::withoutTenancy()->count())->toBe($recipesBefore + 1);

    // The one it did link keeps its validator, its status and its flags: an editor open on the
    // item must not meet a 409 for a write it cannot see, and the unlinked flag stays until a real
    // formulation replaces the placeholder.
    $after = CatalogueItem::withoutTenancy()->whereKey($live->getKey())->sole();

    expect($after->recipe_id)->not->toBeNull()
        ->and($after->lock_version)->toBe(4)
        ->and($after->status)->toBe(CatalogueItemStatus::Published)
        ->and($after->data_quality_flags)->toBe(['recipe_library_unlinked', 'missing_b2b_price']);
});

it('changes nothing on a second run and writes nothing on a dry run', function (): void {
    formulateItem($this->kitchen, CatalogueItemType::Sauce, 'toum');
    formulateItem($this->kitchen, CatalogueItemType::Meal, 'shawarma-plate');

    expect(runFormulate($this->kitchen, ['--dry-run' => true]))->toBe(0)
        ->and(Recipe::withoutTenancy()->count())->toBe(0)
        ->and(CatalogueItem::withoutTenancy()->whereNotNull('recipe_id')->count())->toBe(0)
        ->and(AuditLog::query()->where('action', 'catalogue.item_recipe_backfilled')->count())->toBe(0);

    expect(runFormulate($this->kitchen))->toBe(0);

    $recipes = Recipe::withoutTenancy()->orderBy('id')->pluck('id')->all();

    expect($recipes)->toHaveCount(2);

    expect(runFormulate($this->kitchen))->toBe(0)
        ->and(Recipe::withoutTenancy()->orderBy('id')->pluck('id')->all())->toBe($recipes)
        ->and(AuditLog::query()->where('action', 'catalogue.item_recipe_backfilled')->count())->toBe(2);
});

it('fails the check while anything is unlinked, and passes it once a run has linked it', function (): void {
    formulateItem($this->kitchen, CatalogueItemType::Dressing, 'tahini-dressing');
    formulateItem($this->kitchen, CatalogueItemType::Sauce, 'bought-in-ketchup', ['production_mode' => ProductionMode::Supplier]);

    // Neither side counts a retired item, which is what lets the check pass after the run.
    formulateItem($this->kitchen, CatalogueItemType::Meal, 'withdrawn-plate', ['status' => CatalogueItemStatus::Retired]);

    // The check writes nothing, however much it finds.
    expect(runFormulate($this->kitchen, ['--check' => true]))->toBe(1)
        ->and(Recipe::withoutTenancy()->count())->toBe(0);

    expect(runFormulate($this->kitchen))->toBe(0)
        ->and(runFormulate($this->kitchen, ['--check' => true]))->toBe(0);

    // And the two opposite questions are not asked at once.
    expect(runFormulate($this->kitchen, ['--check' => true, '--undo' => true]))->toBe(1);
});

it('undoes the placeholders: unlinks their items, deletes them, and says so', function (): void {
    $sauce = formulateItem($this->kitchen, CatalogueItemType::Sauce, 'house-toum');
    $meal = formulateItem($this->kitchen, CatalogueItemType::Meal, 'mixed-grill');

    // A recipe somebody made by hand is never a placeholder, however empty it is.
    $handMade = Recipe::factory()->create(['organisation_id' => $this->kitchen->organisation->getKey()]);
    RecipeVersion::factory()->create([
        'recipe_id' => $handMade->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'version_number' => 1,
    ]);

    expect(runFormulate($this->kitchen))->toBe(0);

    $sauceStub = formulatedRecipeId($sauce);
    $mealStub = formulatedRecipeId($meal);

    // A dry undo is a report.
    expect(runFormulate($this->kitchen, ['--undo' => true, '--dry-run' => true]))->toBe(0)
        ->and(Recipe::withoutTenancy()->whereIn('id', [$sauceStub, $mealStub])->count())->toBe(2);

    expect(runFormulate($this->kitchen, ['--undo' => true]))->toBe(0);

    expect(Recipe::withoutTenancy()->whereIn('id', [$sauceStub, $mealStub])->count())->toBe(0)
        // Its version went with it.
        ->and(RecipeVersion::withoutTenancy()->whereIn('recipe_id', [$sauceStub, $mealStub])->count())->toBe(0)
        ->and(formulatedRecipeId($sauce))->toBeNull()
        ->and(formulatedRecipeId($meal))->toBeNull()
        ->and(Recipe::withoutTenancy()->whereKey($handMade->getKey())->exists())->toBeTrue();

    $undone = AuditLog::query()->where('action', 'catalogue.recipe_backfill_undone')->get()->keyBy('subject_id');

    expect($undone)->toHaveCount(2)
        ->and($undone[$sauceStub]->metadata['catalogue_item_ids'])->toBe([(string) $sauce->getKey()])
        ->and($undone[$mealStub]->metadata['catalogue_item_ids'])->toBe([(string) $meal->getKey()]);

    // No key the audit redactor would blank (it matches `code` as a substring).
    foreach (AuditLog::query()->whereIn('action', ['catalogue.item_recipe_backfilled', 'catalogue.recipe_backfill_undone'])->get() as $event) {
        foreach (array_keys($event->metadata ?? []) as $key) {
            expect(str_contains((string) $key, 'code'))->toBeFalse("Audit metadata key [{$key}] would be redacted.");
        }

        expect($event->metadata)->not->toContain('[redacted]');
    }

    // The items are recipe-less again, so the check says so until the next run.
    expect(runFormulate($this->kitchen, ['--check' => true]))->toBe(1);
});

it('keeps a placeholder somebody has worked on', function (): void {
    $formulated = formulateItem($this->kitchen, CatalogueItemType::Sauce, 'formulated-sauce');
    $revised = formulateItem($this->kitchen, CatalogueItemType::Sauce, 'revised-sauce');
    $renamed = formulateItem($this->kitchen, CatalogueItemType::Meal, 'renamed-plate');
    $untouched = formulateItem($this->kitchen, CatalogueItemType::Dressing, 'untouched-dressing');

    expect(runFormulate($this->kitchen))->toBe(0);

    $versionOf = static fn (CatalogueItem $item): RecipeVersion => RecipeVersion::withoutTenancy()
        ->where('recipe_id', formulatedRecipeId($item))
        ->sole();

    // A line written straight to the table — an importer's path, which moves neither validator.
    // The emptiness checks are what catch it.
    $flour = CatalogueWorld::mappedIngredient($this->kitchen->organisation, 'Flour', 'gluten');

    RecipeVersionLine::withoutTenancy()->create([
        'recipe_version_id' => $versionOf($formulated)->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'line_number' => 1,
        'ingredient_id' => $flour->getKey(),
        'quantity' => '100.0000',
        'unit_id' => CatalogueWorld::unit('g'),
    ]);

    // An edit to the version, as its compare-and-swap leaves it: the validator moved.
    RecipeVersion::withoutTenancy()
        ->whereKey($versionOf($revised)->getKey())
        ->update(['notes' => 'Halve the garlic.', 'lock_version' => 1]);

    // And an edit to the recipe itself, with no version touched at all.
    Recipe::withoutTenancy()
        ->whereKey(formulatedRecipeId($renamed))
        ->update(['name_en' => 'Renamed plate (large)', 'lock_version' => 1]);

    $kept = [
        $formulated->slug => formulatedRecipeId($formulated),
        $revised->slug => formulatedRecipeId($revised),
        $renamed->slug => formulatedRecipeId($renamed),
    ];

    expect(runFormulate($this->kitchen, ['--undo' => true]))->toBe(0);

    foreach ($kept as $slug => $recipeId) {
        expect(Recipe::withoutTenancy()->whereKey($recipeId)->exists())->toBeTrue($slug)
            ->and(CatalogueItem::withoutTenancy()->where('slug', $slug)->value('recipe_id'))->toBe($recipeId);
    }

    expect(formulatedRecipeId($untouched))->toBeNull()
        ->and(AuditLog::query()->where('action', 'catalogue.recipe_backfill_undone')->count())->toBe(1);
});

it('refuses to run outside the allowlisted environments', function (): void {
    formulateItem($this->kitchen, CatalogueItemType::Sauce, 'refused-sauce');

    config()->set('kitchens.import.environments', ['local']);

    test()->artisan('kitchen:formulate-unlinked', ['--org' => $this->kitchen->organisation->slug])
        ->expectsOutputToContain('refuses to run')
        ->assertExitCode(1);

    expect(Recipe::withoutTenancy()->count())->toBe(0);
});
