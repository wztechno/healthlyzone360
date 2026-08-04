<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Recipes over HTTP — identity, isolation and concurrency
|--------------------------------------------------------------------------
|
| Two kitchens exist in every test. What has to hold: a kitchen sees its own
| recipes and nobody else's; every write is optimistically locked; every
| mutation is audited; and the pagination survives being walked while rows
| exist beyond one page.
|
| The version lifecycle — publication gates, immutability, the frozen allergen
| label — is RecipeVersionLifecycleTest.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = RecipeWorld::kitchen('chef-a@recipes.test');
    $this->b = RecipeWorld::kitchen('chef-b@recipes.test');
});

it('creates a recipe together with its first draft version', function (): void {
    $this->actingAs($this->a->user);

    $response = $this->postJson('/api/v1/catalogue/recipes', [
        'name_en' => 'House Tahini Sauce',
        'name_ar' => 'صلصة الطحينة',
        'recipe_category' => 'sauce',
    ], RecipeWorld::headers($this->a))
        ->assertCreated()
        ->assertJsonPath('data.recipe.slug', 'house-tahini-sauce')
        ->assertJsonPath('data.recipe.status', 'active')
        // Confidential unless somebody says otherwise: a default that leaks is
        // a default that is wrong exactly once.
        ->assertJsonPath('data.recipe.confidentiality', 'confidential')
        ->assertJsonPath('data.recipe.published_version_number', null)
        ->assertJsonPath('data.recipe.lock_version', 0)
        ->assertJsonPath('data.version.version_number', 1)
        ->assertJsonPath('data.version.status', 'draft')
        // Nothing has been derived yet, and `current` on an empty label would
        // be the most dangerous default available.
        ->assertJsonPath('data.version.derivation_state', 'stale')
        ->assertHeader('ETag', '"0"');

    $recipeId = $response->json('data.recipe.id');

    expect(Recipe::withoutTenancy()->whereKey($recipeId)->value('organisation_id'))
        ->toBe((string) $this->a->organisation->getKey())
        ->and(RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->count())->toBe(1);

    expect(AuditLog::query()->where('action', 'catalogue.recipe_created')->count())->toBe(1)
        ->and(AuditLog::query()->where('action', 'catalogue.recipe_version_created')->count())->toBe(1);
});

it('keeps one kitchens recipes invisible and unreachable to the other', function (): void {
    $theirs = Recipe::factory()->create([
        'organisation_id' => $this->b->organisation->getKey(),
        'name_en' => 'Their Secret Marinade',
    ]);

    $version = RecipeVersion::factory()->create([
        'recipe_id' => $theirs->getKey(),
        'organisation_id' => $this->b->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = RecipeWorld::headers($this->a);

    $listed = collect($this->getJson('/api/v1/catalogue/recipes?limit=100', $headers)->assertOk()->json('data'))
        ->pluck('id')
        ->all();

    expect($listed)->not->toContain((string) $theirs->getKey());

    // Not merely hidden from the list: unreachable by identifier, and
    // indistinguishable from a recipe that never existed.
    $this->getJson('/api/v1/catalogue/recipes/'.$theirs->getKey(), $headers)
        ->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found');

    $this->getJson('/api/v1/catalogue/recipes/'.$theirs->getKey().'/versions/'.$version->getKey(), $headers)
        ->assertNotFound();

    $this->putJson('/api/v1/catalogue/recipes/'.$theirs->getKey().'/versions/'.$version->getKey().'/lines',
        ['lines' => []], $headers + ['If-Match' => '"0"'])
        ->assertNotFound();

    expect(RecipeVersion::withoutTenancy()->whereKey($version->getKey())->value('lock_version'))->toBe(0);
});

it('demands a precondition, refuses a stale one and accepts the current one', function (): void {
    $recipe = Recipe::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'name_en' => 'Toum',
    ]);

    $this->actingAs($this->a->user);
    $headers = RecipeWorld::headers($this->a);
    $url = '/api/v1/catalogue/recipes/'.$recipe->getKey();

    $this->patchJson($url, ['name_en' => 'Toum (mild)'], $headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required')
        ->assertJsonPath('error.details.required_headers', ['If-Match']);

    $etag = $this->getJson($url, $headers)->assertOk()->assertHeader('ETag', '"0"')->headers->get('ETag');

    $this->patchJson($url, ['name_en' => 'Toum (mild)'], $headers + ['If-Match' => (string) $etag])
        ->assertOk()
        ->assertJsonPath('data.recipe.name_en', 'Toum (mild)')
        ->assertJsonPath('data.recipe.lock_version', 1)
        ->assertHeader('ETag', '"1"');

    $this->patchJson($url, ['name_en' => 'Toum (hot)'], $headers + ['If-Match' => (string) $etag])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.current_lock_version', 1);

    expect(Recipe::withoutTenancy()->whereKey($recipe->getKey())->value('name_en'))->toBe('Toum (mild)');
});

it('guards a version write with the versions own validator', function (): void {
    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);
    $version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = RecipeWorld::headers($this->a);
    $url = '/api/v1/catalogue/recipes/'.$recipe->getKey().'/versions/'.$version->getKey();

    $this->patchJson($url, ['notes' => 'Halve the salt.'], $headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');

    $this->patchJson($url, ['notes' => 'Halve the salt.'], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.version.notes', 'Halve the salt.')
        ->assertHeader('ETag', '"1"');

    $this->patchJson($url, ['notes' => 'Again'], $headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.details.current_lock_version', 1);

    // The version number addresses the same row as the identifier.
    $this->getJson('/api/v1/catalogue/recipes/'.$recipe->getKey().'/versions/1', $headers)
        ->assertOk()
        ->assertJsonPath('data.version.id', (string) $version->getKey());
});

it('rejects a validator that is not an ETag this API issued', function (): void {
    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $this->actingAs($this->a->user);

    $this->patchJson('/api/v1/catalogue/recipes/'.$recipe->getKey(), ['name_en' => 'Nope'],
        RecipeWorld::headers($this->a) + ['If-Match' => '"not-a-version"'])
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');
});

it('archives a recipe, refuses a second archive and hides it from the default list', function (): void {
    $recipe = Recipe::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'name_en' => 'Discontinued Dressing',
    ]);

    $this->actingAs($this->a->user);
    $headers = RecipeWorld::headers($this->a);
    $url = '/api/v1/catalogue/recipes/'.$recipe->getKey().'/archive';

    $this->postJson($url, [], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.recipe.status', 'archived')
        ->assertHeader('ETag', '"1"');

    $this->postJson($url, [], $headers + ['If-Match' => '"1"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    expect(collect($this->getJson('/api/v1/catalogue/recipes?limit=100&query=Discontinued', $headers)->json('data'))->pluck('id')->all())
        ->toBe([])
        ->and(collect($this->getJson('/api/v1/catalogue/recipes?limit=100&query=Discontinued&status=archived', $headers)->json('data'))->pluck('id')->all())
        ->toBe([(string) $recipe->getKey()])
        ->and(Recipe::withoutTenancy()->whereKey($recipe->getKey())->sole()->status)->toBe(RecipeStatus::Archived);

    $this->getJson('/api/v1/catalogue/recipes?status=vanished', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');
});

it('walks a cursor-paginated recipe book with no gaps and no duplicates', function (): void {
    $this->actingAs($this->a->user);
    $headers = RecipeWorld::headers($this->a);

    Recipe::factory()->count(30)->create(['organisation_id' => $this->a->organisation->getKey()]);

    $expected = Recipe::withoutTenancy()
        ->where('organisation_id', $this->a->organisation->getKey())
        ->orderBy('created_at')
        ->orderBy('id')
        ->pluck('id')
        ->all();

    $seen = [];
    $cursor = null;
    $pages = 0;

    do {
        $url = '/api/v1/catalogue/recipes?limit=7'.($cursor === null ? '' : '&cursor='.urlencode($cursor));
        $response = $this->getJson($url, $headers)->assertOk();

        foreach ($response->json('data') as $item) {
            $seen[] = $item['id'];
        }

        $cursor = $response->json('meta.next_cursor');
        $pages++;

        expect($pages)->toBeLessThan(60, 'The cursor walk did not terminate.');
    } while ($response->json('meta.has_more') === true);

    expect($seen)->toBe($expected)
        ->and(count($seen))->toBe(count(array_unique($seen)));
});

it('refuses a cursor it did not issue', function (): void {
    $this->actingAs($this->a->user);

    $this->getJson('/api/v1/catalogue/recipes?cursor=not-a-cursor', RecipeWorld::headers($this->a))
        ->assertStatus(400)
        ->assertJsonPath('error.details.parameter', 'cursor');
});

it('denies a member without the recipe permissions', function (): void {
    $stranger = User::factory()->create();

    OrganisationMembership::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'user_id' => $stranger->getKey(),
    ]);

    $this->actingAs($stranger);

    $this->getJson('/api/v1/catalogue/recipes', RecipeWorld::headers($this->a))
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.reason', 'permission_not_granted');
});

it('lets a chef edit a formulation but never publish one', function (): void {
    // The permission split is the point: a chef writes formulations, and
    // deciding what the kitchen sells is somebody else's decision.
    $chef = RecipeWorld::kitchen('sous-chef@recipes.test', [
        'recipe.view_organisation',
        'recipe.manage_organisation',
    ]);

    $recipe = Recipe::factory()->create(['organisation_id' => $chef->organisation->getKey()]);
    $version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $chef->organisation->getKey(),
    ]);

    $this->actingAs($chef->user);
    $headers = RecipeWorld::headers($chef);

    $this->patchJson('/api/v1/catalogue/recipes/'.$recipe->getKey().'/versions/'.$version->getKey(),
        ['notes' => 'More lemon.'], $headers + ['If-Match' => '"0"'])
        ->assertOk();

    $this->postJson('/api/v1/catalogue/recipes/'.$recipe->getKey().'/versions/'.$version->getKey().'/publish',
        [], $headers + ['If-Match' => '"1"'])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.permission', 'recipe.publish_organisation');
});

it('never writes an audit metadata key the redactor would blank', function (): void {
    $this->actingAs($this->a->user);
    $headers = RecipeWorld::headers($this->a);

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Audited Sauce'], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->patchJson('/api/v1/catalogue/recipes/'.$recipeId, ['name_en' => 'Audited Sauce v2'],
        $headers + ['If-Match' => '"0"'])->assertOk();

    $ingredient = RecipeWorld::mappedIngredient($this->a->organisation, 'Tahini', 'sesame');

    $this->putJson('/api/v1/catalogue/recipes/'.$recipeId.'/versions/1/lines', [
        'lines' => [['ingredient_id' => (string) $ingredient->getKey(), 'quantity' => 250, 'unit_id' => RecipeWorld::unit()]],
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson('/api/v1/catalogue/recipes/'.$recipeId.'/versions/1/publish', [],
        $headers + ['If-Match' => '"1"'])->assertOk();

    $events = AuditLog::query()->where('action', 'like', 'catalogue.recipe%')->get();

    expect($events)->not->toBeEmpty()
        ->and($events->pluck('action')->unique()->values()->all())->toContain(
            'catalogue.recipe_created',
            'catalogue.recipe_updated',
            'catalogue.recipe_version_created',
            'catalogue.recipe_lines_replaced',
            'catalogue.recipe_version_published',
        );

    foreach ($events as $event) {
        foreach (array_keys($event->metadata ?? []) as $key) {
            // The redactor matches `code` as a substring, so any key ending in
            // `_code` would be persisted as "[redacted]" (OQ-036).
            expect(str_ends_with((string) $key, '_code'))
                ->toBeFalse("Audit metadata key [{$key}] would be redacted by the substring match.");
        }

        expect($event->metadata)->not->toContain('[redacted]');
    }
});

it('filters the recipe index to rows whose current version derivation is stale', function (): void {
    $this->actingAs($this->a->user);
    $headers = RecipeWorld::headers($this->a);

    $staleRecipe = Recipe::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'name_en' => 'Stale Marinade',
    ]);
    RecipeVersion::factory()->create([
        'recipe_id' => $staleRecipe->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'derivation_state' => 'stale',
    ]);

    $freshRecipe = Recipe::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'name_en' => 'Fresh Marinade',
    ]);
    RecipeVersion::factory()->published()->create([
        'recipe_id' => $freshRecipe->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'derivation_state' => DerivationState::Current,
    ]);

    $ids = collect(
        $this->getJson('/api/v1/catalogue/recipes?stale_only=1&limit=100', $headers)
            ->assertOk()
            ->json('data'),
    )->pluck('id')->all();

    expect($ids)->toContain((string) $staleRecipe->getKey())
        ->and($ids)->not->toContain((string) $freshRecipe->getKey());
});
