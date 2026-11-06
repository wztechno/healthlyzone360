<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Allergens\Database\Seeders\AllergenSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Kitchens\Services\MarketplaceMeals;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| "Ingredients to leave out" — the customer's ingredient search
|--------------------------------------------------------------------------
|
| A customer has no kitchen context, so the search reads past the tenant
| scope. These tests pin what that may reach: the platform library and the
| kitchen ingredients a meal on sale lists — never anything else a kitchen
| keeps — and that a saved exclusion comes back with its name.
|
*/

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
        AllergenSeeder::class,
    ]);

    $this->world = CheckoutWorld::build('leave-out@kitchen.test');
    $this->user = User::factory()->create();

    $condiment = IngredientCategory::withoutTenancy()->create([
        'organisation_id' => null,
        'code' => 'condiment-test',
        'name_en' => 'Condiment',
        'name_ar' => 'توابل',
        'display_order' => 1,
        'is_active' => true,
    ]);

    $this->balsamic = Ingredient::factory()->platform()->create([
        'name_en' => 'Balsamic Vinegar',
        'name_ar' => 'خل بلسمي',
        'ingredient_category_id' => $condiment->getKey(),
    ]);
    $this->cider = Ingredient::factory()->platform()->create(['name_en' => 'Apple Cider Vinegar']);
    $this->vineLeaves = Ingredient::factory()->platform()->create(['name_en' => 'Vine leaves']);
    $this->retired = Ingredient::factory()->platform()->archived()->create(['name_en' => 'Vinegar, retired']);

    // The kitchen's own: one its meal on sale lists, one it only keeps.
    $this->listed = Ingredient::factory()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'name_en' => 'House vinegar',
    ]);
    $this->privateRow = Ingredient::factory()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'name_en' => 'Secret vinegar blend',
    ]);

    CatalogueItemIngredient::factory()->create([
        'catalogue_item_id' => $this->world->meal->getKey(),
        'ingredient_id' => $this->listed->getKey(),
    ]);
});

it('finds the library and the kitchen ingredients a meal on sale lists, and nothing else a kitchen keeps', function (): void {
    expect(app(MarketplaceMeals::class)->visible()->whereKey($this->world->meal->getKey())->exists())->toBeTrue();

    $this->actingAs($this->user);

    $found = $this->getJson('/api/v1/me/dietary-profile/ingredients?q=vine', firstPartyHeaders())
        ->assertOk()
        ->assertJsonStructure(['data' => [['id', 'name', 'category']], 'meta' => ['correlation_id', 'count']])
        ->json('data');

    $names = array_column($found, 'name');

    expect($names)->toContain('Balsamic Vinegar', 'Apple Cider Vinegar', 'House vinegar')
        ->not->toContain('Secret vinegar blend')
        ->not->toContain('Vinegar, retired')
        // A name that starts with the term comes before one that only contains it.
        ->and($names[0])->toBe('Vine leaves');

    $balsamic = collect($found)->firstWhere('id', (string) $this->balsamic->getKey());
    expect($balsamic)->toBe([
        'id' => (string) $this->balsamic->getKey(),
        'name' => 'Balsamic Vinegar',
        'category' => 'Condiment',
    ]);

    // Only the three fields; nothing a kitchen keeps rides along.
    expect(array_keys($found[0]))->toBe(['id', 'name', 'category']);
});

it('answers in Arabic when asked, and caps the page', function (): void {
    $this->actingAs($this->user);

    $this->getJson('/api/v1/me/dietary-profile/ingredients?q=balsamic', ['Accept-Language' => 'ar', ...firstPartyHeaders()])
        ->assertOk()
        ->assertJsonPath('data.0.name', 'خل بلسمي')
        ->assertJsonPath('data.0.category', 'توابل');

    $this->getJson('/api/v1/me/dietary-profile/ingredients?q=vine&limit=2', firstPartyHeaders())
        ->assertOk()
        ->assertJsonCount(2, 'data');
});

it('refuses a term shorter than two characters, and a guest', function (): void {
    $this->getJson('/api/v1/me/dietary-profile/ingredients?q=vi', firstPartyHeaders())->assertUnauthorized();

    $this->actingAs($this->user);

    $this->getJson('/api/v1/me/dietary-profile/ingredients?q=v', firstPartyHeaders())
        ->assertUnprocessable()
        ->assertJsonPath('error.code', 'validation.failed');

    $this->getJson('/api/v1/me/dietary-profile/ingredients?q=%20%20', firstPartyHeaders())
        ->assertUnprocessable();

    // `%` and `_` are letters here, not wildcards.
    $this->getJson('/api/v1/me/dietary-profile/ingredients?q=%25%25', firstPartyHeaders())
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('serves each saved exclusion with its kind and the ingredient name', function (): void {
    $this->actingAs($this->user);
    $this->postJson('/api/v1/customer-account', [], firstPartyHeaders())->assertCreated();

    $saved = $this->putJson('/api/v1/me/dietary-profile', [
        'allergens' => [],
        'exclusions' => [
            ['kind' => 'dislike', 'ingredient_id' => (string) $this->listed->getKey()],
            ['kind' => 'forbidden', 'free_text' => 'Alcohol'],
        ],
    ], firstPartyHeaders())->assertOk()->json('data.dietary_profile.exclusions');

    $read = $this->getJson('/api/v1/me/dietary-profile', firstPartyHeaders())
        ->assertOk()
        ->json('data.dietary_profile.exclusions');

    foreach ([$saved, $read] as $exclusions) {
        $bySubject = collect($exclusions)->keyBy('subject_kind');

        expect($bySubject['ingredient'])->toMatchArray([
            'kind' => 'dislike',
            'ingredient_id' => (string) $this->listed->getKey(),
            'ingredient_name' => 'House vinegar',
        ])->and($bySubject['free_text'])->toMatchArray([
            'kind' => 'forbidden',
            'free_text' => 'Alcohol',
            'ingredient_name' => null,
        ]);
    }
});
