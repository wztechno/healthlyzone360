<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The catalogue readiness evaluator, and the only thing worth proving
|--------------------------------------------------------------------------
|
| `GET …/readiness` and `POST …/publish` must never disagree. Lifting the gates
| out of `PublishCatalogueItem` into `CatalogueItemReadiness` leaves one
| implementation and two callers; the risk it creates is that somebody later
| "fixes" one of them. So every test builds a state, asks the endpoint why the
| listing cannot be published, then attempts the publication and asserts the
| refusal names exactly the same reasons in the same order.
|
| `plan_prices_incomplete` appears alongside the plan reasons here for the
| reason `PlanPublicationTest` gives: nothing in this suite is priced, because
| proving a price needs tariffs and the module dependency runs Pricing →
| Catalogues. The equivalence assertion covers it either way — both surfaces
| report it or neither does.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('readiness@catalogue.test');
    $this->headers = CatalogueWorld::headers($this->a);

    $this->actingAs($this->a->user);
});

/**
 * What the readiness endpoint says, as `[publishable, reasons]`.
 *
 * @return array{0: bool, 1: list<array<string, mixed>>}
 */
function itemReadiness(CatalogueItem $item, array $headers): array
{
    $response = test()->getJson('/api/v1/catalogue/items/'.$item->getKey().'/readiness', $headers)->assertOk();

    return [(bool) $response->json('data.publishable'), (array) $response->json('data.reasons')];
}

/**
 * What the publish action refuses with, as machine codes in the order reported.
 *
 * @return list<string>
 */
function itemPublishRefusalCodes(CatalogueItem $item, array $headers, int $lockVersion): array
{
    $response = test()->postJson(
        '/api/v1/catalogue/items/'.$item->getKey().'/publish',
        [],
        $headers + ['If-Match' => '"'.$lockVersion.'"'],
    )->assertStatus(409)->assertJsonPath('error.code', 'catalogue.publish_blocked');

    /** @var list<string> */
    return collect($response->json('error.details.reasons'))->pluck('reason')->all();
}

/**
 * Both surfaces, compared.
 *
 * @return list<array<string, mixed>> the readiness reasons, for the caller to
 *                                    make its own assertions about context
 */
function assertReadinessMatchesPublish(CatalogueItem $item, array $headers, int $lockVersion): array
{
    [$publishable, $reasons] = itemReadiness($item, $headers);

    expect($publishable)->toBeFalse()
        ->and(collect($reasons)->pluck('code')->all())
        ->toBe(itemPublishRefusalCodes($item, $headers, $lockVersion));

    return $reasons;
}

it('reports a publishable product as publishable, and the publication then succeeds', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);

    [$publishable, $reasons] = itemReadiness($item, $this->headers);

    expect($publishable)->toBeTrue()->and($reasons)->toBe([]);

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [],
        $this->headers + ['If-Match' => '"0"'])->assertOk();
});

it('reports and refuses an untranslated listing identically', function (): void {
    $item = CatalogueItem::factory()->untranslated()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $reasons = assertReadinessMatchesPublish($item, $this->headers, 0);

    expect(collect($reasons)->pluck('code')->all())->toBe(['translation_incomplete', 'no_active_variant'])
        ->and($reasons[0]['context']['fields'])->toBe(['name_ar']);
});

it('reports and refuses a product with no pack identically', function (): void {
    $item = CatalogueItem::factory()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'صنف',
    ]);

    $reasons = assertReadinessMatchesPublish($item, $this->headers, 0);

    expect(collect($reasons)->pluck('code')->all())->toBe(['no_active_variant'])
        ->and($reasons[0]['context'])->toBe([]);
});

it('reports and refuses a meal that cannot say what is in it identically', function (): void {
    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
    ]);

    $reasons = assertReadinessMatchesPublish($item, $this->headers, 0);

    expect(collect($reasons)->pluck('code')->all())->toBe(['no_allergen_basis']);
});

it('reports and refuses a quarantined listing identically, carrying its reason', function (): void {
    $item = CatalogueItem::factory()->quarantined()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'صنف',
        'review_reason' => 'Allergen recompute changed the published label: now declares peanut.',
    ]);

    $reasons = assertReadinessMatchesPublish($item, $this->headers, 0);

    expect($reasons[0]['code'])->toBe('item_quarantined')
        ->and($reasons[0]['context']['review_reason'])->toContain('peanut');
});

it('reports and refuses a listing that is already on sale identically', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a, 'Live Product');

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [],
        $this->headers + ['If-Match' => '"0"'])->assertOk();

    $reasons = assertReadinessMatchesPublish($item->refresh(), $this->headers, 1);

    expect($reasons[0]['code'])->toBe('item_not_a_draft')
        ->and($reasons[0]['context']['status'])->toBe('published');
});

it('reports and refuses a listing whose recipe is under review identically', function (): void {
    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'version_number' => 1,
        'status' => 'review_required',
        'review_reason' => 'Allergen recompute changed the published label: now declares peanut.',
    ]);

    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $recipe->getKey(),
    ]);

    $item->ingredients()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'ingredient_id' => CatalogueWorld::mappedIngredient($this->a->organisation, 'Tahini', 'sesame')->getKey(),
        'display_order' => 1,
    ]);

    $reasons = assertReadinessMatchesPublish($item, $this->headers, 0);

    expect(collect($reasons)->pluck('code')->all())->toBe(['linked_recipe_quarantined'])
        ->and($reasons[0]['context']['recipe_id'])->toBe((string) $recipe->getKey())
        ->and($reasons[0]['context']['recipe_version_ids'])->toBe([(string) $version->getKey()]);
});

it('reports and refuses an unfinished plan identically, in the same order', function (): void {
    $plan = CatalogueWorld::plan($this->a);

    $reasons = assertReadinessMatchesPublish($plan, $this->headers, 0);

    expect(collect($reasons)->pluck('code')->all())
        ->toBe(['plan_profile_missing', 'no_active_plan_configuration']);
});

it('reports and refuses a plan with a matrix but no run identically', function (): void {
    $plan = CatalogueWorld::plan($this->a);
    $combination = CatalogueWorld::combination($this->a->organisation, 'lunch-dinner');

    $this->putJson('/api/v1/catalogue/plans/'.$plan->getKey().'/profile', [],
        $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson('/api/v1/catalogue/plans/'.$plan->getKey().'/variants', [
        'cells' => [['meal_combination_option_id' => (string) $combination->getKey(), 'meals_per_day' => 2]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    $reasons = assertReadinessMatchesPublish($plan->refresh(), $this->headers, 2);

    $codes = collect($reasons)->pluck('code')->all();

    expect($codes)->toContain('no_duration_assigned')
        ->and($codes)->toContain('plan_prices_incomplete')
        ->and($codes)->not->toContain('plan_profile_missing');

    $prices = collect($reasons)->firstWhere('code', 'plan_prices_incomplete');

    // The matrix a merchandiser is looking at is labelled by code, so the
    // refusal names the cells by code as well as by identifier.
    expect($prices['context']['configurations'])->toBe(['lunch-dinner-standard'])
        ->and($prices['context']['catalogue_item_variant_ids'])->toHaveCount(1);
});

it('carries the listing state in meta, so a client never has to ask twice', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a, 'Meta Product');

    $this->getJson('/api/v1/catalogue/items/'.$item->getKey().'/readiness', $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.slug', $item->slug)
        ->assertJsonPath('meta.item_type', 'product')
        ->assertJsonPath('meta.status', 'draft');
});

it('is a read, so it needs the read permission and not the publish one', function (): void {
    $stranger = CatalogueWorld::kitchen('no-catalogue-read@catalogue.test', ['recipe.view_organisation']);

    $item = CatalogueWorld::publishableProduct($stranger, 'Hidden Product');

    forgetResolvedGuards();
    $this->actingAs($stranger->user);

    $this->getJson('/api/v1/catalogue/items/'.$item->getKey().'/readiness', CatalogueWorld::headers($stranger))
        ->assertStatus(403);
});
