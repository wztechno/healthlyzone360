<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| Allergen release
|--------------------------------------------------------------------------
|
| A recompute that moves a published label quarantines the version and its
| listings. A manager compares the old label (`previous_label`) with the new
| one, ticks that they checked, and releases: the new label goes live on the
| same version and the listings go back on sale. Never while the label is
| stale, never unticked, always audited.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('release@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);

    $this->actingAs($this->kitchen->user);

    $this->tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');

    $this->recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Tahini Sauce'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $this->tahini->getKey(), 'quantity' => 250, 'unit_id' => RecipeWorld::unit()]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->versionId = (string) $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->json('data.version.id');

    $catalogue = Catalogue::factory()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'code' => 'default',
    ]);

    $this->item = CatalogueItem::factory()->meal()->published()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $this->recipeId,
    ]);

    // Buyable (S3), so a later version of the recipe it sells may publish.
    PricingWorld::sellable($this->kitchen, $this->item);

    // The supplier now says the tahini also runs on peanut equipment. The queue
    // is synchronous here, so the recompute quarantines the version at once.
    $this->putJson('/api/v1/catalogue/ingredients/'.$this->tahini->getKey().'/allergens', [
        'mappings' => [
            ['allergen_code' => 'sesame', 'containment' => 'contains'],
            ['allergen_code' => RecipeWorld::allergen('peanut')->code, 'containment' => 'may_contain'],
        ],
    ], $this->headers)->assertOk();

    $this->releasePath = "/api/v1/catalogue/recipes/{$this->recipeId}/versions/{$this->versionId}/release";
});

/**
 * The version as it stands, read past the tenant scope.
 */
function releaseSubject(string $versionId): RecipeVersion
{
    return RecipeVersion::withoutTenancy()->whereKey($versionId)->sole();
}

/**
 * Change the tahini's peanut statement, which moves every label built on it.
 *
 * @param  array<string, string>  $headers
 */
function releaseTestRemapPeanut(string $ingredientId, array $headers, string $containment): void
{
    test()->putJson('/api/v1/catalogue/ingredients/'.$ingredientId.'/allergens', [
        'mappings' => [
            ['allergen_code' => 'sesame', 'containment' => 'contains'],
            ['allergen_code' => RecipeWorld::allergen('peanut')->code, 'containment' => $containment],
        ],
    ], $headers)->assertOk();
}

/**
 * Version 2 published beside the quarantined version 1, then quarantined in
 * its turn by a second mapping edit: two versions in review, none published.
 * Returns version 2's id.
 *
 * @param  array<string, string>  $headers
 */
function releaseTestQuarantineSecondVersion(string $recipeId, string $ingredientId, array $headers): string
{
    test()->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions", ['copy_from_version' => 1], $headers)
        ->assertCreated();

    $secondId = (string) test()->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/2/publish", [],
        $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->json('data.version.id');

    releaseTestRemapPeanut($ingredientId, $headers, 'contains');

    expect(releaseSubject($secondId)->status)->toBe(RecipeVersionStatus::ReviewRequired);

    return $secondId;
}

it('keeps the old label on the quarantined version and serves it beside the new one', function (): void {
    $version = releaseSubject($this->versionId);

    expect($version->status)->toBe(RecipeVersionStatus::ReviewRequired)
        ->and($version->previous_label)->toBe(['sesame' => 'contains']);

    $this->getJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/{$this->versionId}", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.version.previous_label', ['sesame' => 'contains'])
        ->assertJsonCount(2, 'data.allergens');

    $this->getJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/{$this->versionId}/readiness", $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.status', 'review_required')
        ->assertJsonPath('meta.previous_label', ['sesame' => 'contains']);
});

it('releases the version and puts its listings back on sale', function (): void {
    $version = releaseSubject($this->versionId);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertOk()
        ->assertHeader('ETag', '"'.($version->lock_version + 1).'"')
        ->assertJsonPath('data.version.status', 'published')
        ->assertJsonPath('data.version.review_reason', null)
        ->assertJsonPath('data.version.previous_label', null);

    $version->refresh();

    expect($version->status)->toBe(RecipeVersionStatus::Published)
        ->and($version->review_reason)->toBeNull()
        ->and($version->previous_label)->toBeNull();

    // The new label is what went live: the release does not re-derive it.
    $this->getJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/{$this->versionId}/allergens", $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data');

    $this->item->refresh();

    expect($this->item->status)->toBe(CatalogueItemStatus::Published)
        ->and($this->item->review_reason)->toBeNull();
});

it('refuses a release nobody ticked', function (mixed $confirmed): void {
    $version = releaseSubject($this->versionId);
    $body = $confirmed === 'absent' ? [] : ['confirmed' => $confirmed];

    $this->postJson($this->releasePath, $body, $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertUnprocessable()
        ->assertJsonPath('error.code', 'validation.failed');

    expect(releaseSubject($this->versionId)->status)->toBe(RecipeVersionStatus::ReviewRequired)
        ->and($this->item->refresh()->status)->toBe(CatalogueItemStatus::ReviewRequired);
})->with([
    'false' => [false],
    'absent' => ['absent'],
    'one' => [1],
    'string one' => ['1'],
    'yes' => ['yes'],
]);

it('marks a quarantined version stale when a mapping moves under it', function (): void {
    Queue::fake();

    $this->putJson('/api/v1/catalogue/ingredients/'.$this->tahini->getKey().'/allergens', [
        'mappings' => [
            ['allergen_code' => 'sesame', 'containment' => 'contains'],
            ['allergen_code' => RecipeWorld::allergen('peanut')->code, 'containment' => 'contains'],
        ],
    ], $this->headers)->assertOk();

    $version = releaseSubject($this->versionId);

    expect($version->status)->toBe(RecipeVersionStatus::ReviewRequired)
        ->and($version->derivation_state)->toBe(DerivationState::Stale);

    Queue::assertPushed(
        RecomputeRecipeDerivations::class,
        fn (RecomputeRecipeDerivations $job): bool => $job->recipeVersionId === $this->versionId,
    );
});

it('refuses to release a stale label', function (): void {
    Queue::fake();

    $this->putJson('/api/v1/catalogue/ingredients/'.$this->tahini->getKey().'/allergens', [
        'mappings' => [
            ['allergen_code' => 'sesame', 'containment' => 'contains'],
            ['allergen_code' => RecipeWorld::allergen('peanut')->code, 'containment' => 'contains'],
        ],
    ], $this->headers)->assertOk();

    $version = releaseSubject($this->versionId);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertConflict()
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.reason', 'derivation_stale');

    expect(releaseSubject($this->versionId)->status)->toBe(RecipeVersionStatus::ReviewRequired)
        ->and($this->item->refresh()->status)->toBe(CatalogueItemStatus::ReviewRequired);
});

it('refuses to release a label whose recompute failed', function (): void {
    RecipeVersion::withoutTenancy()->whereKey($this->versionId)->update(['derivation_state' => DerivationState::Failed->value]);

    $version = releaseSubject($this->versionId);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertConflict()
        ->assertJsonPath('error.details.reason', 'derivation_stale');
});

it('refuses to release a label built on an ingredient nobody has assessed', function (): void {
    // What a retired sub-recipe leaves its output with: no rows, no claim, not
    // verified. The label in review reads as fine; publish would refuse it.
    IngredientAllergen::withoutTenancy()->where('ingredient_id', $this->tahini->getKey())->delete();
    Ingredient::withoutTenancy()->whereKey($this->tahini->getKey())->update([
        'verification_status' => IngredientVerificationStatus::Unverified->value,
        'allergens_derived_from_version_id' => null,
    ]);

    $version = releaseSubject($this->versionId);

    expect($version->derivation_state)->toBe(DerivationState::Current);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertConflict()
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.reason', 'allergen_unmapped')
        ->assertJsonPath('error.details.ingredient_ids', [(string) $this->tahini->getKey()]);

    expect(releaseSubject($this->versionId)->status)->toBe(RecipeVersionStatus::ReviewRequired)
        ->and($this->item->refresh()->status)->toBe(CatalogueItemStatus::ReviewRequired);
});

it('refuses a release sent against a label that has moved since it was compared', function (): void {
    // The manager opens the comparison at this validator...
    $compared = releaseSubject($this->versionId)->lock_version;

    // ...and the label moves underneath them: the recompute lands (the queue is
    // synchronous), the state is current again, and peanut is now `contains`.
    releaseTestRemapPeanut((string) $this->tahini->getKey(), $this->headers, 'contains');

    $version = releaseSubject($this->versionId);

    expect($version->derivation_state)->toBe(DerivationState::Current)
        ->and($version->lock_version)->toBe($compared + 1);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$compared.'"'])
        ->assertConflict();

    expect(releaseSubject($this->versionId)->status)->toBe(RecipeVersionStatus::ReviewRequired)
        ->and($this->item->refresh()->status)->toBe(CatalogueItemStatus::ReviewRequired);
});

it('bumps the validator whichever path ran the recompute, and only when the label moved', function (): void {
    $compared = releaseSubject($this->versionId)->lock_version;

    // The same mappings saved again: recomputed, unchanged, validator kept.
    releaseTestRemapPeanut((string) $this->tahini->getKey(), $this->headers, 'may_contain');

    expect(releaseSubject($this->versionId)->lock_version)->toBe($compared);

    // A moved label, recomputed the way `propagate()` and the import commands
    // run it: the job's own `handle()`, with no queue in front of it.
    Queue::fake();

    releaseTestRemapPeanut((string) $this->tahini->getKey(), $this->headers, 'contains');

    app()->call([new RecomputeRecipeDerivations($this->versionId, (string) $this->kitchen->organisation->getKey(), 1), 'handle']);

    expect(releaseSubject($this->versionId)->lock_version)->toBe($compared + 1);
});

it('queues a recompute when a quarantined version is edited', function (): void {
    Queue::fake();

    $version = releaseSubject($this->versionId);

    $this->putJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/{$this->versionId}/lines", [
        'lines' => [['ingredient_id' => (string) $this->tahini->getKey(), 'quantity' => 300, 'unit_id' => RecipeWorld::unit()]],
    ], $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])->assertOk();

    expect(releaseSubject($this->versionId)->derivation_state)->toBe(DerivationState::Stale);

    Queue::assertPushed(
        RecomputeRecipeDerivations::class,
        fn (RecomputeRecipeDerivations $job): bool => $job->recipeVersionId === $this->versionId,
    );
});

it('retires the released version when a newer one is still in review', function (): void {
    releaseTestQuarantineSecondVersion($this->recipeId, (string) $this->tahini->getKey(), $this->headers);

    $version = releaseSubject($this->versionId);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertOk()
        ->assertJsonPath('data.version.status', 'retired');
});

it('holds the listings until no version of the recipe is left in review', function (): void {
    $secondId = releaseTestQuarantineSecondVersion($this->recipeId, (string) $this->tahini->getKey(), $this->headers);

    $first = releaseSubject($this->versionId);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$first->lock_version.'"'])
        ->assertOk();

    expect($this->item->refresh()->status)->toBe(CatalogueItemStatus::ReviewRequired);

    $second = releaseSubject($secondId);

    $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/{$secondId}/release", ['confirmed' => true],
        $this->headers + ['If-Match' => '"'.$second->lock_version.'"'])
        ->assertOk()
        ->assertJsonPath('data.version.status', 'published');

    expect($this->item->refresh()->status)->toBe(CatalogueItemStatus::Published);
});

it('refuses to release a version that is not in review', function (): void {
    $version = releaseSubject($this->versionId);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertOk();

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.($version->lock_version + 1).'"'])
        ->assertConflict()
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.status', 'published');
});

it('retires the released version when a newer one is already published', function (): void {
    $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions", ['copy_from_version' => 1], $this->headers)
        ->assertCreated();

    $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/2/publish", [],
        $this->headers + ['If-Match' => '"0"'])
        ->assertOk();

    $version = releaseSubject($this->versionId);

    // Publishing version 2 demotes only a *published* incumbent.
    expect($version->status)->toBe(RecipeVersionStatus::ReviewRequired);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertOk()
        ->assertJsonPath('data.version.status', 'retired');

    expect(RecipeVersion::withoutTenancy()->where('recipe_id', $this->recipeId)->where('version_number', 2)->sole()->status)
        ->toBe(RecipeVersionStatus::Published)
        ->and($this->item->refresh()->status)->toBe(CatalogueItemStatus::Published);
});

it('audits the release with both labels and every listing it released', function (): void {
    $version = releaseSubject($this->versionId);

    $this->postJson($this->releasePath, ['confirmed' => true], $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertOk();

    $event = AuditLog::query()->where('action', 'catalogue.allergen_release')->sole();

    expect($event->subject_type)->toBe('recipe_version')
        ->and($event->subject_id)->toBe($this->versionId)
        ->and($event->metadata['outcome'] ?? null)->toBe('published')
        ->and($event->metadata['previous_contains_classes'] ?? null)->toBe(['sesame'])
        ->and($event->metadata['previous_may_contain_classes'] ?? null)->toBe([])
        ->and($event->metadata['released_contains_classes'] ?? null)->toBe(['sesame'])
        ->and($event->metadata['released_may_contain_classes'] ?? null)->toBe(['peanut'])
        ->and($event->metadata['released_item_ids'] ?? null)->toBe([(string) $this->item->getKey()]);

    // OQ-036: the redactor blanks any key containing `code`.
    foreach (array_keys($event->metadata ?? []) as $key) {
        expect(str_contains(strtolower((string) $key), 'code'))->toBeFalse();
    }

    $released = AuditLog::query()->where('action', 'catalogue.item_released')->sole();

    expect($released->subject_id)->toBe((string) $this->item->getKey())
        ->and($released->metadata['origin'] ?? null)->toBe('allergen_release');
});

it('refuses a release to a caller without recipe.publish_organisation', function (): void {
    $chef = RecipeWorld::kitchen('release-chef@recipes.test', [
        'recipe.view_organisation',
        'recipe.manage_organisation',
    ]);

    $recipe = Recipe::factory()->create(['organisation_id' => $chef->organisation->getKey()]);
    $version = RecipeVersion::factory()->quarantined()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $chef->organisation->getKey(),
    ]);

    $this->actingAs($chef->user);

    $this->postJson('/api/v1/catalogue/recipes/'.$recipe->getKey().'/versions/'.$version->getKey().'/release',
        ['confirmed' => true], RecipeWorld::headers($chef) + ['If-Match' => '"'.$version->lock_version.'"'])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.permission', 'recipe.publish_organisation');

    expect($version->refresh()->status)->toBe(RecipeVersionStatus::ReviewRequired);
});
