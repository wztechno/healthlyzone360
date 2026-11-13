<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| A sold recipe publishes only once what sells it can be bought (S3)
|--------------------------------------------------------------------------
|
| Owner ruling 7. A recipe a meal, sauce, dressing or frozen meal sells is
| refused publication through the API until each seller has a pack, a place it
| is offered on and a price on every such place — asked through the
| RecipeUsageRegistry port, raised with the structural reasons as one
| `catalogue.publish_blocked`, and reported the same way by the readiness
| endpoint. A preparation is never asked, and the console paths publish with
| the rule off.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('selling-publish@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);

    $this->actingAs($this->kitchen->user);

    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');

    $this->recipeId = (string) $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Tahini Sauce'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    // A publishable draft at lock 1: everything structural is in order.
    $this->putJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $tahini->getKey(), 'quantity' => 250, 'unit_id' => RecipeWorld::unit()]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->catalogue = Catalogue::factory()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'code' => 'default',
    ]);

    $this->seller = fn (array $attributes = []): CatalogueItem => CatalogueItem::factory()->sauce()->create($attributes + [
        'catalogue_id' => $this->catalogue->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'name_ar' => 'صلصة الطحينة',
        'recipe_id' => $this->recipeId,
    ]);

    $this->publish = fn () => $this->postJson(
        "/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/publish",
        [],
        $this->headers + ['If-Match' => '"1"'],
    );
});

it('refuses to publish a recipe a draft sauce sells with no pack and no place, naming the sauce', function (): void {
    $sauce = ($this->seller)();

    $reasons = ($this->publish)()
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toBe(['no_pack', 'no_selling_place'])
        ->and(collect($reasons)->pluck('catalogue_item_id')->unique()->all())->toBe([(string) $sauce->getKey()])
        ->and($reasons[0]['item_type'])->toBe('sauce')
        ->and(RecipeVersion::withoutTenancy()->where('recipe_id', $this->recipeId)->sole()->status)
        ->toBe(RecipeVersionStatus::Draft);

    // The editor's tray asks the readiness endpoint, and it says the same.
    $readiness = $this->getJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/readiness", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.publishable', false)
        ->json('data.reasons');

    expect(collect($readiness)->pluck('code')->all())->toBe(['no_pack', 'no_selling_place'])
        ->and($readiness[0]['context']['catalogue_item_id'])->toBe((string) $sauce->getKey());
});

it('names the place offered with no price, then publishes once it is priced', function (): void {
    $sauce = ($this->seller)();

    $pack = PricingWorld::sellable($this->kitchen, $sauce);
    $price = PriceListItem::withoutTenancy()->where('catalogue_item_id', $sauce->getKey())->sole();
    $list = PriceList::withoutTenancy()->whereKey($price->price_list_id)->sole();
    $price->delete();

    $reasons = ($this->publish)()
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toBe(['place_unpriced'])
        ->and($reasons[0]['place'])->toBe('home')
        ->and($reasons[0]['catalogue_item_id'])->toBe((string) $sauce->getKey());

    PricingWorld::price($list, $sauce, $pack, 900);

    $this->getJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/readiness", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.publishable', true);

    ($this->publish)()
        ->assertOk()
        ->assertJsonPath('data.version.status', 'published');
});

it('publishes past the rule when the caller opts out, as the console paths do', function (): void {
    ($this->seller)();

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $this->recipeId)->sole();

    // The console commands run inside one kitchen with no request behind them.
    $organisationId = (string) $this->kitchen->organisation->getKey();
    app(TenantContext::class)->restore(['organisation_id' => $organisationId]);
    app(DatabaseTenantContext::class)->apply(null, $organisationId, null);

    try {
        $published = app(RecipeVersionService::class)->publish($version, $version->lock_version, applySellingRule: false);
    } finally {
        app(TenantContext::class)->clear();
        app(DatabaseTenantContext::class)->reset();
    }

    expect($published->status)->toBe(RecipeVersionStatus::Published);
});

it('never asks a preparation, nor a retired seller', function (): void {
    $readiness = "/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/readiness";

    // Nothing sells it: a preparation.
    $this->getJson($readiness, $this->headers)->assertOk()->assertJsonPath('data.reasons', []);

    // Retired is withdrawn for good: nothing will ever be bought through it.
    ($this->seller)(['status' => 'retired']);

    $this->getJson($readiness, $this->headers)->assertOk()->assertJsonPath('data.reasons', []);

    ($this->publish)()
        ->assertOk()
        ->assertJsonPath('data.version.status', 'published');
});
