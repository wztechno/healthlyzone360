<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Http\Middleware\RequirePlatformContext;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Services\AllergenMappingService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| The reactive derivation recompute — K1.8
|--------------------------------------------------------------------------
|
| K1.2 marked a published label stale when the mappings underneath it moved,
| and stopped there. This is the other half: the job that re-derives the
| label, re-fingerprints it, re-costs the formulation, and — when the label a
| diner was promised has actually changed — pulls the version and everything
| selling it off sale.
|
| Five things have to hold.
|
| 1. A mapping edit that changes nothing leaves a published version published.
|    A quarantine nobody needed is a review queue nobody reads.
| 2. A mapping edit that changes the label quarantines the version, names the
|    delta in words, audits it without a redactable key, and takes the
|    listings with it.
| 3. A platform-baseline edit reaches *every* tenant, not the operator's own
|    context — the documented K1.2 gap.
| 4. The walk follows outputs into the versions that consume them.
| 5. Two components that produce what the other consumes terminate.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('recompute@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();

    $this->actingAs($this->kitchen->user);
});

/**
 * A recipe whose version 1 is published from the given line ingredients,
 * returned as the version identifier.
 *
 * Published through the API rather than by factory state, because the frozen
 * label is what the recompute compares against and a factory-made "published"
 * row has no label at all.
 *
 * @param  list<Ingredient>  $ingredients
 */
function publishedVersionId(object $kitchen, array $headers, string $unitId, array $ingredients, string $name): string
{
    $recipeId = test()->postJson('/api/v1/catalogue/recipes', ['name_en' => $name], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => array_map(
            static fn (Ingredient $ingredient): array => [
                'ingredient_id' => (string) $ingredient->getKey(),
                'quantity' => 250,
                'unit_id' => $unitId,
            ],
            $ingredients,
        ),
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    return (string) test()->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->json('data.version.id');
}

/**
 * Run one recompute here and now.
 *
 * `handle()` through the container rather than `dispatchSync()`, because
 * `dispatchSync` on a `ShouldQueue` job still routes through the `sync`
 * *connection* — and a faked queue records that push instead of running it. The
 * tests below need the job to actually execute while its own `dispatch()` calls
 * land in the fake, which is exactly what calling the method gives.
 *
 * @param  list<string>  $visited
 */
function runRecompute(string $versionId, string $organisationId, int $depth = 0, array $visited = []): void
{
    app()->call([new RecomputeRecipeDerivations($versionId, $organisationId, $depth, $visited), 'handle']);
}

it('leaves a published version alone when the recomputed label says the same thing', function (): void {
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');

    $versionId = publishedVersionId($this->kitchen, $this->headers, $this->grams, [$tahini], 'Tahini Sauce');

    // The same statement, written again. A mapping editor saving an unchanged
    // set is an ordinary thing to do, and it must not cost the kitchen a dish.
    $this->putJson('/api/v1/catalogue/ingredients/'.$tahini->getKey().'/allergens', [
        'mappings' => [['allergen_code' => 'sesame', 'containment' => 'contains']],
    ], $this->headers)->assertOk();

    $version = RecipeVersion::withoutTenancy()->whereKey($versionId)->sole();

    expect($version->status)->toBe(RecipeVersionStatus::Published)
        ->and($version->derivation_state)->toBe(DerivationState::Current)
        ->and($version->review_reason)->toBeNull()
        ->and($version->derived_at)->not->toBeNull()
        ->and($version->derived_input_hash)->toHaveLength(64);

    expect(AuditLog::query()->where('action', 'catalogue.allergen_rollup_changed')->count())->toBe(0);
});

it('quarantines a published version whose label changed, names the delta and takes the listing with it', function (): void {
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');

    $versionId = publishedVersionId($this->kitchen, $this->headers, $this->grams, [$tahini], 'Tahini Sauce');

    $recipeId = (string) RecipeVersion::withoutTenancy()->whereKey($versionId)->sole()->recipe_id;

    $catalogue = Catalogue::factory()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'code' => 'default',
    ]);

    $item = CatalogueItem::factory()->meal()->published()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $recipeId,
    ]);

    // The supplier now says the tahini line is also run on shared peanut
    // equipment. That is a different promise from the one on the menu.
    $this->putJson('/api/v1/catalogue/ingredients/'.$tahini->getKey().'/allergens', [
        'mappings' => [
            ['allergen_code' => 'sesame', 'containment' => 'contains'],
            ['allergen_code' => RecipeWorld::allergen('peanut')->code, 'containment' => 'may_contain'],
        ],
    ], $this->headers)->assertOk();

    $version = RecipeVersion::withoutTenancy()->whereKey($versionId)->sole();

    expect($version->status)->toBe(RecipeVersionStatus::ReviewRequired)
        ->and($version->derivation_state)->toBe(DerivationState::Current)
        ->and($version->review_reason)->toContain('peanut')
        ->and(mb_strlen((string) $version->review_reason))->toBeLessThanOrEqual(200);

    $event = AuditLog::query()->where('action', 'catalogue.allergen_rollup_changed')->sole();

    expect($event->metadata['recipe_version_id'] ?? null)->toBe($versionId)
        ->and($event->metadata['recipe_id'] ?? null)->toBe($recipeId)
        ->and($event->metadata['added_allergen_classes'] ?? null)->toBe(['peanut'])
        ->and($event->metadata['removed_allergen_classes'] ?? null)->toBe([])
        ->and($event->metadata['changed_allergen_classes'] ?? null)->toBe([]);

    // OQ-036: the audit redactor matches `code` as a substring, so a metadata
    // key containing it would arrive blanked — on a food-safety event, a trail
    // that records that something changed and refuses to say what.
    foreach (array_keys($event->metadata ?? []) as $key) {
        expect(str_contains(strtolower((string) $key), 'code'))->toBeFalse();
    }

    // The promise is made on the listing, not on the formulation, so the
    // listing has to come off sale too.
    $item->refresh();

    expect($item->status)->toBe(CatalogueItemStatus::ReviewRequired)
        ->and($item->review_reason)->toContain('peanut');

    $quarantine = AuditLog::query()->where('action', 'catalogue.item_quarantined')->sole();

    expect($quarantine->subject_id)->toBe((string) $item->getKey())
        ->and($quarantine->metadata['origin'] ?? null)->toBe('allergen_rollup_changed');
});

it('does not quarantine a draft version whose label changed', function (): void {
    // Only a published label is a promise to a diner. A draft is somebody's
    // work in progress, and quarantining it would put a version into review
    // that nobody has proposed selling.
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Draft Sauce'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $tahini->getKey(), 'quantity' => 250, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    runRecompute((string) $version->getKey(), (string) $this->kitchen->organisation->getKey());

    $version->refresh();

    expect($version->status)->toBe(RecipeVersionStatus::Draft)
        ->and($version->derivation_state)->toBe(DerivationState::Current);

    expect(AuditLog::query()->where('action', 'catalogue.allergen_rollup_changed')->count())->toBe(0);
});

it('fans a platform baseline correction out to every organisation that uses the ingredient', function (): void {
    // The documented K1.2 gap. A platform operator rewriting the baseline
    // cannot see another tenant's recipe versions from their own context, so
    // the fan-out restores each organisation in turn.
    $second = RecipeWorld::kitchen('second-kitchen@recipes.test');

    $soySauce = Ingredient::factory()->platform()->create(['name_en' => 'Soya Sauce']);

    IngredientAllergen::asPlatformRow(fn (): IngredientAllergen => IngredientAllergen::withoutTenancy()->create([
        'ingredient_id' => $soySauce->getKey(),
        'organisation_id' => null,
        'allergen_code' => RecipeWorld::allergen('soy')->code,
        'containment' => AllergenContainment::Contains,
        'market_scope' => 'all',
        'source' => 'master_list',
        'verification_status' => 'verified',
    ]));

    $first = publishedVersionId($this->kitchen, $this->headers, $this->grams, [$soySauce], 'Soy Glaze');

    $this->actingAs($second->user);
    $secondId = publishedVersionId($second, RecipeWorld::headers($second), $this->grams, [$soySauce], 'Soy Marinade');

    // The platform operator's context. Its organisation *type* is what makes
    // the write a baseline write — never a request field.
    $platform = Organisation::factory()->create([
        'organisation_type_id' => OrganisationType::query()->where('code', RequirePlatformContext::PLATFORM_OPERATOR_TYPE)->sole()->getKey(),
        'country_code' => 'LB',
        'default_currency_code' => 'USD',
        'default_language_code' => 'en',
    ]);

    app(TenantContext::class)->setOrganisation(
        (string) $this->kitchen->user->getKey(),
        (string) $platform->getKey(),
    );

    app(AllergenMappingService::class)->replace($soySauce, AllergenMarketScope::All, [
        ['allergen_code' => RecipeWorld::allergen('soy')->code, 'containment' => 'contains', 'source' => 'master_list'],
        ['allergen_code' => RecipeWorld::allergen('gluten')->code, 'containment' => 'contains', 'source' => 'master_list'],
    ]);

    $versions = RecipeVersion::withoutTenancy()->whereKey([$first, $secondId])->get();

    expect($versions)->toHaveCount(2)
        ->and($versions->pluck('status')->unique()->all())->toBe([RecipeVersionStatus::ReviewRequired])
        ->and($versions->pluck('organisation_id')->unique()->count())->toBe(2);

    foreach ($versions as $version) {
        expect((string) $version->review_reason)->toContain('gluten');
    }

    $event = AuditLog::query()->where('action', 'catalogue.ingredient_allergens_updated')->sole();

    expect($event->metadata['layer'] ?? null)->toBe('platform_baseline')
        ->and($event->metadata['affected_organisations'] ?? null)->toBe(2)
        ->and($event->metadata['stale_recipe_versions'] ?? null)->toBe(2);

    // Two organisations, two quarantines, and neither trail names the other
    // tenant.
    expect(AuditLog::query()->where('action', 'catalogue.allergen_rollup_changed')->count())->toBe(2);
});

it('follows an output into the versions that consume it', function (): void {
    // A version that *produces* an ingredient other formulations use is a
    // component, and the versions built on it are downstream of every
    // recompute of it.
    $sesame = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Sesame Seed', 'sesame');
    $paste = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'House Tahini', 'sesame');

    $componentId = publishedVersionId($this->kitchen, $this->headers, $this->grams, [$sesame], 'House Tahini Batch');
    $component = RecipeVersion::withoutTenancy()->whereKey($componentId)->sole();

    $component->outputs()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'ingredient_id' => $paste->getKey(),
        'output_quantity' => '900.0000',
        'unit_id' => $this->grams,
        'is_primary' => true,
    ]);

    $downstreamId = publishedVersionId($this->kitchen, $this->headers, $this->grams, [$paste], 'Hummus');

    Queue::fake();

    runRecompute($componentId, (string) $this->kitchen->organisation->getKey());

    Queue::assertPushed(
        RecomputeRecipeDerivations::class,
        fn (RecomputeRecipeDerivations $job): bool => $job->recipeVersionId === $downstreamId
            && $job->depth === 1
            && $job->visited === [$componentId],
    );

    Queue::assertPushed(RecomputeRecipeDerivations::class, 1);
});

it('terminates when two versions each produce what the other consumes', function (): void {
    // A legitimate formulation graph and an infinite recursion look identical
    // from one hop. The visited set is what tells them apart.
    $first = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Component One', 'sesame');
    $second = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Component Two', 'soy');

    $aId = publishedVersionId($this->kitchen, $this->headers, $this->grams, [$second], 'Makes One');
    $bId = publishedVersionId($this->kitchen, $this->headers, $this->grams, [$first], 'Makes Two');

    $organisationId = (string) $this->kitchen->organisation->getKey();

    RecipeVersion::withoutTenancy()->whereKey($aId)->sole()->outputs()->create([
        'organisation_id' => $organisationId,
        'ingredient_id' => $first->getKey(),
        'output_quantity' => '500.0000',
        'unit_id' => $this->grams,
        'is_primary' => true,
    ]);

    RecipeVersion::withoutTenancy()->whereKey($bId)->sole()->outputs()->create([
        'organisation_id' => $organisationId,
        'ingredient_id' => $second->getKey(),
        'output_quantity' => '500.0000',
        'unit_id' => $this->grams,
        'is_primary' => true,
    ]);

    Queue::fake();

    runRecompute($aId, $organisationId);

    Queue::assertPushed(RecomputeRecipeDerivations::class, 1);

    /** @var RecomputeRecipeDerivations $next */
    $next = Queue::pushed(RecomputeRecipeDerivations::class)->sole();

    expect($next->recipeVersionId)->toBe($bId)
        ->and($next->visited)->toBe([$aId]);

    // The second hop would close the loop. It does not: A is already visited,
    // so nothing further is scheduled and the count stays where it was.
    runRecompute($bId, $organisationId, $next->depth, $next->visited);

    Queue::assertPushed(RecomputeRecipeDerivations::class, 1);
});

it('stops at the depth cap rather than walking forever', function (): void {
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Base', 'sesame');
    $produced = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Component', 'sesame');

    $sourceId = publishedVersionId($this->kitchen, $this->headers, $this->grams, [$ingredient], 'Deep Base');

    RecipeVersion::withoutTenancy()->whereKey($sourceId)->sole()->outputs()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'ingredient_id' => $produced->getKey(),
        'output_quantity' => '900.0000',
        'unit_id' => $this->grams,
        'is_primary' => true,
    ]);

    publishedVersionId($this->kitchen, $this->headers, $this->grams, [$produced], 'Deep Consumer');

    Queue::fake();

    // At the cap the version is still recomputed — the label is the point —
    // and only the propagation stops.
    runRecompute(
        $sourceId,
        (string) $this->kitchen->organisation->getKey(),
        RecomputeRecipeDerivations::MAX_DEPTH,
    );

    Queue::assertNothingPushed();

    expect(RecipeVersion::withoutTenancy()->whereKey($sourceId)->sole()->derivation_state)
        ->toBe(DerivationState::Current);
});
