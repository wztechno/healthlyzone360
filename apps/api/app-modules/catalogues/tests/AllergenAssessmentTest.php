<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\B2b\Tests\Fixtures\B2bCheckoutWorld;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Kitchens\Services\MarketplaceMeals;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;

/*
|--------------------------------------------------------------------------
| Not assessed
|--------------------------------------------------------------------------
|
| A dish with no allergens read "None declared by the kitchen" even when nobody
| had looked. Now somebody has to have looked, one of four ways, or it is off
| sale. The row-level-security case is the one to read twice: the marketplace
| and the corporate catalogue cannot see a recipe, and a plain `EXISTS` passes
| under the owner this suite runs as while hiding every recipe-backed dish there.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('assessor@catalogue.test');
});

function unassessedItem(object $tenant, array $attributes = []): CatalogueItem
{
    return CatalogueItem::factory()->meal()->published()->notAssessed()->create([
        'catalogue_id' => $tenant->catalogue->getKey(),
        'organisation_id' => $tenant->organisation->getKey(),
        ...$attributes,
    ]);
}

function publishedRecipe(object $tenant, int $lines): Recipe
{
    $organisationId = (string) $tenant->organisation->getKey();
    $recipe = Recipe::factory()->create(['organisation_id' => $organisationId]);
    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisationId,
    ]);

    for ($number = 1; $number <= $lines; $number++) {
        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $organisationId,
            'line_number' => $number,
            // The line factory's own ingredient invents an organisation, and with it a
            // random country on top of the seeded ones.
            'ingredient_id' => Ingredient::factory()->create(['organisation_id' => $organisationId])->getKey(),
        ]);
    }

    return $recipe;
}

function isAssessed(CatalogueItem $item): bool
{
    return CatalogueItem::withoutTenancy()->whereKey($item->getKey())->allergensAssessed()->exists();
}

it('treats an item nothing vouches for as not assessed', function (): void {
    expect(isAssessed(unassessedItem($this->a)))->toBeFalse();
});

it('accepts a published recipe version with a line', function (): void {
    $item = unassessedItem($this->a, ['recipe_id' => publishedRecipe($this->a, 1)->getKey()]);

    expect(isAssessed($item))->toBeTrue();
});

it('does not accept a published recipe with no lines', function (): void {
    $item = unassessedItem($this->a, ['recipe_id' => publishedRecipe($this->a, 0)->getKey()]);

    expect(isAssessed($item))->toBeFalse();
});

it('accepts an allergen recorded through the item\'s ingredients', function (): void {
    $item = unassessedItem($this->a);
    $ingredient = CatalogueWorld::mappedIngredient($this->a->organisation, 'Tahini', 'sesame');

    CatalogueItemIngredient::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'catalogue_item_id' => $item->getKey(),
        'ingredient_id' => $ingredient->getKey(),
        'is_representative' => false,
        'display_order' => 0,
    ]);

    expect(isAssessed($item))->toBeTrue();
});

it('does not accept listed ingredients that carry no allergen', function (): void {
    $item = unassessedItem($this->a);
    $ingredient = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    CatalogueItemIngredient::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'catalogue_item_id' => $item->getKey(),
        'ingredient_id' => $ingredient->getKey(),
        'is_representative' => false,
        'display_order' => 0,
    ]);

    expect(isAssessed($item))->toBeFalse();
});

it('accepts an item that is exactly one ingredient', function (): void {
    $ingredient = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    expect(isAssessed(unassessedItem($this->a, ['ingredient_id' => $ingredient->getKey()])))->toBeTrue();
});

it('accepts a member of staff stating it contains none, and audits who', function (): void {
    $item = unassessedItem($this->a);

    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/allergens-assessed', [], CatalogueWorld::headers($this->a))
        ->assertOk()
        ->assertJsonPath('data.item.allergens_assessed', true);

    $item->refresh();

    expect(isAssessed($item))->toBeTrue()
        ->and($item->allergens_assessed_at)->not->toBeNull()
        ->and($item->allergens_assessed_by)->toBe((string) $this->a->user->getKey())
        ->and(AuditLog::query()->where('action', 'catalogue.item_allergens_assessed')->count())->toBe(1);
});

it('refuses that statement for an item something else already vouches for', function (): void {
    $item = unassessedItem($this->a, ['recipe_id' => publishedRecipe($this->a, 1)->getKey()]);

    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/allergens-assessed', [], CatalogueWorld::headers($this->a))
        ->assertStatus(409);

    expect($item->refresh()->allergens_assessed_at)->toBeNull();
});

it('refuses that statement without the catalogue permission', function (): void {
    $viewer = CatalogueWorld::kitchen('viewer@catalogue.test', ['catalogue.view_organisation']);
    $theirs = unassessedItem($viewer);

    $this->actingAs($viewer->user);

    $this->postJson('/api/v1/catalogue/items/'.$theirs->getKey().'/allergens-assessed', [], CatalogueWorld::headers($viewer))
        ->assertForbidden();

    expect($theirs->refresh()->allergens_assessed_at)->toBeNull();
});

it('asks nothing of a subscription plan, which is not food', function (): void {
    $plan = CatalogueWorld::plan($this->a);
    $plan->forceFill(['allergens_assessed_at' => null])->save();

    expect(isAssessed($plan))->toBeTrue();
});

it('answers the same with no tenant, as the marketplace asks it', function (): void {
    // Through the runtime role, the only way this suite meets the policy on
    // `recipe_versions`. A plain EXISTS reads nothing here.
    $item = unassessedItem($this->a, ['recipe_id' => publishedRecipe($this->a, 1)->getKey()]);

    RuntimeRole::context();

    expect(RuntimeRole::run(fn (): bool => isAssessed($item)))->toBeTrue();
});

it('answers the same under another organisation, as a corporate buyer asks it', function (): void {
    $item = unassessedItem($this->a, ['recipe_id' => publishedRecipe($this->a, 1)->getKey()]);
    $buyer = CatalogueWorld::kitchen('buyer@catalogue.test');

    RuntimeRole::context(organisationId: (string) $buyer->organisation->getKey());

    expect(RuntimeRole::run(fn (): bool => isAssessed($item)))->toBeTrue();
});

it('refuses an unassessed line as item_not_assessed', function (): void {
    $world = DeskWorld::build('assessment-probe@kitchen.test');
    $world->meal->forceFill(['allergens_assessed_at' => null])->save();

    $probe = fn (bool $enforce) => app(LineProbe::class)->probe(
        $world->channel,
        (string) $world->meal->getKey(),
        null,
        '1',
        null,
        'USD',
        enforceAssessment: $enforce,
    );

    expect(array_column($probe(true)->refusals, 'reason'))->toBe(['item_not_assessed'])
        // What a subscription delivery and an accepted quotation pass.
        ->and($probe(false)->isOrderable())->toBeTrue();
});

it('marks an unassessed line on the desk quote rather than hiding it', function (): void {
    $world = DeskWorld::build('assessment-desk@kitchen.test');
    $world->meal->forceFill(['allergens_assessed_at' => null])->save();

    $this->actingAs(DeskWorld::agent($world, 'assessment-agent@desk.test'));

    $this->postJson('/api/v1/catalogue/order-desk/quote', [
        'fulfilment_type' => 'counter',
        'lines' => [['catalogue_item_id' => (string) $world->meal->getKey(), 'quantity' => 1]],
    ], DeskWorld::headers($world))
        ->assertOk()
        ->assertJsonPath('data.quote.lines.0.refusals.0.reason', 'item_not_assessed');
});

it('hides an unassessed dish from the marketplace', function (): void {
    $world = DeskWorld::build('assessment-market@kitchen.test');
    $visible = fn (): bool => app(MarketplaceMeals::class)->visible()->whereKey($world->meal->getKey())->exists();

    expect($visible())->toBeTrue();

    $world->meal->forceFill(['allergens_assessed_at' => null])->save();

    expect($visible())->toBeFalse();
});

it('hides an unassessed dish from the corporate catalogue', function (): void {
    $world = B2bCheckoutWorld::dualAgreement();
    $buyer = $world['buyers']['acme'];
    $world['meal']->forceFill(['allergens_assessed_at' => null])->save();

    $this->actingAs($buyer['user']);

    $this->getJson('/api/v1/b2b/catalogue/items', $buyer['headers'])
        ->assertOk()
        ->assertJsonMissing(['id' => (string) $world['meal']->getKey()]);

    $this->getJson('/api/v1/b2b/catalogue/items/'.$world['meal']->getKey(), $buyer['headers'])
        ->assertNotFound();
});

it('keeps an unassessed dish in the kitchen catalogue, saying so', function (): void {
    $item = unassessedItem($this->a);

    $this->actingAs($this->a->user);

    $this->getJson('/api/v1/catalogue/items/'.$item->getKey(), CatalogueWorld::headers($this->a))
        ->assertOk()
        ->assertJsonPath('data.item.allergens_assessed', false)
        ->assertJsonPath('data.item.on_sale_without_recipe', true);
});

it('warns only about a dish on sale, and only a dish', function (): void {
    $this->actingAs($this->a->user);

    $product = CatalogueItem::factory()->published()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);
    $draft = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);
    $backed = CatalogueItem::factory()->meal()->published()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'recipe_id' => publishedRecipe($this->a, 1)->getKey(),
    ]);

    foreach ([$product, $draft, $backed] as $item) {
        $this->getJson('/api/v1/catalogue/items/'.$item->getKey(), CatalogueWorld::headers($this->a))
            ->assertJsonPath('data.item.on_sale_without_recipe', false);
    }
});

it('reports the unassessed and changes nothing', function (): void {
    $item = unassessedItem($this->a, ['name_en' => 'Nobody checked this']);
    $other = CatalogueWorld::kitchen('other@catalogue.test');
    unassessedItem($other, ['name_en' => 'Nor this']);
    CatalogueWorld::publishedMeal($this->a, 'Stamped by a cook');
    $before = CatalogueItem::withoutTenancy()->orderBy('id')->get()->toArray();

    $this->artisan('catalogue:report-unassessed')
        ->expectsOutputToContain('Nobody checked this')
        ->expectsOutputToContain('Nor this')
        ->doesntExpectOutputToContain('Stamped by a cook')
        ->expectsOutputToContain('2 published item(s)')
        ->assertSuccessful();

    $this->artisan('catalogue:report-unassessed', ['--org' => $this->a->organisation->slug])
        ->expectsOutputToContain('Nobody checked this')
        ->doesntExpectOutputToContain('Nor this')
        ->assertSuccessful();

    expect(CatalogueItem::withoutTenancy()->orderBy('id')->get()->toArray())->toBe($before)
        ->and($item->refresh()->allergens_assessed_at)->toBeNull();
});
