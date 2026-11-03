<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemOption;
use Healthy360\Catalogues\Services\DishOptions;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Customers\Enums\AllergenSeverity;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Customers\Models\CustomerFoodExclusion;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Services\MealSafetyService;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| A sauce or side choice brings its recipe's allergens
|--------------------------------------------------------------------------
|
| Owner, 3 Nov 2026: a choice links the sauce or side recipe it is and takes its
| allergens from that recipe. The dish here has a published recipe that declares
| nothing, so any conflict an egg-allergic customer meets came from the sauce.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('choices@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'choices-agent@desk.test');
    $this->headers = DeskWorld::headers($this->world);
    $this->account = $this->world->customer->account;
    $this->organisationId = (string) $this->world->organisation->getKey();

    // The dish itself declares nothing, through a published recipe.
    $this->world->meal->forceFill(['recipe_id' => choiceRecipe($this->organisationId, null)->getKey()])->save();

    $this->actingAs($this->agent);
});

/**
 * A recipe with a published version of one line, labelled with `$allergen` (or
 * nothing). `$published = false` leaves it a draft, with no basis.
 */
function choiceRecipe(string $organisationId, ?string $allergen, bool $published = true): Recipe
{
    $recipe = Recipe::factory()->create(['organisation_id' => $organisationId]);

    if (! $published) {
        return $recipe;
    }

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisationId,
    ]);

    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $organisationId,
        'line_number' => 1,
        'ingredient_id' => Ingredient::factory()->create(['organisation_id' => $organisationId])->getKey(),
    ]);

    if ($allergen !== null) {
        RecipeVersionAllergen::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $organisationId,
            'allergen_code' => allergenCode($allergen),
        ]);
    }

    return $recipe;
}

function allergenCode(string $code): string
{
    return (string) (Allergen::query()->where('code', $code)->value('code') ?? Allergen::factory()->create(['code' => $code])->code);
}

function dishChoice(CatalogueItem $dish, ?string $recipeId, string $name = 'Aioli'): string
{
    $option = new CatalogueItemOption;
    $option->forceFill([
        'organisation_id' => (string) $dish->organisation_id,
        'catalogue_item_id' => (string) $dish->getKey(),
        'kind' => 'choice',
        'group_en' => 'Sauce',
        'group_ar' => 'صلصة',
        'name_en' => $name,
        'name_ar' => $name,
        'recipe_id' => $recipeId,
        'display_order' => 0,
    ])->save();

    return (string) $option->getKey();
}

function declareEggAllergy(CustomerAccount $account): void
{
    $profile = CustomerDietaryProfile::query()->where('customer_account_id', $account->getKey())->firstOrFail();
    $profile->declares_no_allergens = false;
    $profile->save();

    CustomerAllergenDeclaration::query()->create([
        'customer_dietary_profile_id' => $profile->getKey(),
        'allergen_code' => allergenCode('egg'),
        'severity' => AllergenSeverity::Anaphylaxis,
        'notes' => null,
        'declared_at' => CarbonImmutable::now(),
    ]);
}

/**
 * @param  list<string>  $optionIds
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function choicePickupBody(object $test, array $optionIds, array $overrides = []): array
{
    return [
        'fulfilment_type' => 'pickup',
        'payment_method' => 'cash_at_counter',
        'customer_account_id' => (string) $test->account->getKey(),
        'lines' => [['catalogue_item_id' => (string) $test->world->meal->getKey(), 'quantity' => 1, 'option_ids' => $optionIds]],
        ...$overrides,
    ];
}

it('makes an egg-allergic buyer\'s order conflict when the chosen sauce\'s recipe contains egg', function (): void {
    declareEggAllergy($this->account);
    $aioli = dishChoice($this->world->meal, (string) choiceRecipe($this->organisationId, 'egg')->getKey());

    // The dish alone is safe for them.
    $this->postJson('/api/v1/catalogue/order-desk/quote', choicePickupBody($this, []), $this->headers)
        ->assertOk()
        ->assertJsonPath('data.quote.allergen_conflicts', []);

    // With the aioli, the desk is told, and placement waits for the acknowledgement.
    $this->postJson('/api/v1/catalogue/order-desk/quote', choicePickupBody($this, [$aioli]), $this->headers)
        ->assertOk()
        ->assertJsonPath('data.quote.allergen_conflicts.0.reason', 'allergen_declared')
        ->assertJsonPath('data.quote.allergen_conflicts.0.allergen_codes', ['egg']);

    $this->postJson('/api/v1/catalogue/order-desk/orders', choicePickupBody($this, [$aioli]), $this->headers + ['Idempotency-Key' => 'aioli-refused'])
        ->assertStatus(409)
        ->assertJsonPath('error.details.reasons.0.reason', 'allergen_conflict')
        ->assertJsonPath('error.details.reasons.0.allergen_codes', ['egg']);

    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        choicePickupBody($this, [$aioli], ['acknowledge_allergen_conflicts' => true]),
        $this->headers + ['Idempotency-Key' => 'aioli-acknowledged'],
    )->assertCreated();

    $order = Order::query()->sole();
    $line = $order->lines()->sole();

    expect($order->allergy_snapshot[0]['allergen_code'])->toBe('egg')
        ->and($order->allergy_snapshot[0]['conflicts_with_line'])->toBe([(string) $line->getKey()]);
});

it('puts the chosen sauce\'s allergen on the kitchen payload', function (): void {
    $aioli = dishChoice($this->world->meal, (string) choiceRecipe($this->organisationId, 'egg')->getKey());

    $this->postJson('/api/v1/catalogue/order-desk/orders', choicePickupBody($this, [$aioli]), $this->headers + ['Idempotency-Key' => 'aioli-kitchen'])
        ->assertCreated();

    $order = Order::query()->sole();

    expect($order->lines()->sole()->allergens)->toEqual([['allergen_code' => 'egg', 'containment' => 'contains']]);

    $this->getJson("/api/v1/catalogue/orders/{$order->getKey()}", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.order.lines.0.allergens.0.allergen_code', 'egg');
});

it('leaves a line without the sauce on the dish\'s own label', function (): void {
    dishChoice($this->world->meal, (string) choiceRecipe($this->organisationId, 'egg')->getKey());

    $this->postJson('/api/v1/catalogue/order-desk/orders', choicePickupBody($this, []), $this->headers + ['Idempotency-Key' => 'plain-line'])
        ->assertCreated();

    expect(Order::query()->sole()->lines()->sole()->allergens)->toBe([]);
});

it('does not offer an unlinked choice and refuses one named anyway as option_unlinked', function (): void {
    $dishId = (string) $this->world->meal->getKey();
    $legacy = dishChoice($this->world->meal, null, 'Garlic');
    $options = app(DishOptions::class);

    expect(array_column($options->forItem($dishId), 'id'))->not->toContain($legacy)
        ->and($options->snapshot($dishId, [$legacy]))->toBeNull()
        ->and($options->refusal($dishId, [$legacy]))->toBe('option_unlinked');

    $this->postJson('/api/v1/catalogue/order-desk/quote', choicePickupBody($this, [$legacy]), $this->headers)
        ->assertOk()
        ->assertJsonPath('data.quote.lines.0.refusals.0.reason', 'option_unlinked')
        ->assertJsonPath('data.quote.quotable', false);

    $this->postJson('/api/v1/catalogue/order-desk/orders', choicePickupBody($this, [$legacy]), $this->headers + ['Idempotency-Key' => 'unlinked'])
        ->assertStatus(409)
        ->assertJsonPath('error.details.reasons.0.reason', 'option_unlinked');

    expect(Order::query()->count())->toBe(0);
});

it('takes the dish off sale while a linked recipe has no published version', function (): void {
    $draft = choiceRecipe($this->organisationId, null, published: false);
    dishChoice($this->world->meal, (string) $draft->getKey());
    $assessed = fn (): bool => CatalogueItem::withoutTenancy()->whereKey($this->world->meal->getKey())->allergensAssessed()->exists();

    expect($assessed())->toBeFalse();

    $version = RecipeVersion::factory()->published()->create(['recipe_id' => $draft->getKey(), 'organisation_id' => $this->organisationId]);
    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->organisationId,
        'line_number' => 1,
        'ingredient_id' => Ingredient::factory()->create(['organisation_id' => $this->organisationId])->getKey(),
    ]);

    expect($assessed())->toBeTrue();
});

it('shows each offered choice\'s allergens before purchase, and unassessed as null, never none', function (): void {
    $dishId = (string) $this->world->meal->getKey();
    $aioli = dishChoice($this->world->meal, (string) choiceRecipe($this->organisationId, 'egg')->getKey(), 'Aioli');
    $salsa = dishChoice($this->world->meal, (string) choiceRecipe($this->organisationId, null)->getKey(), 'Salsa');
    $draft = dishChoice($this->world->meal, (string) choiceRecipe($this->organisationId, null, published: false)->getKey(), 'Pesto');

    $offered = array_column(app(DishOptions::class)->forItem($dishId), 'allergens', 'id');

    expect($offered[$aioli])->toBe([['allergen_code' => 'egg', 'containment' => 'contains']])
        ->and($offered[$salsa])->toBe([])
        ->and($offered[$draft])->toBeNull();

    $served = $this->getJson("/api/v1/catalogue/order-desk/items/{$dishId}/choices", $this->headers)
        ->assertOk()
        ->json('data.options');

    expect(array_column($served, 'allergens', 'id'))->toBe($offered);
});

it('reads every choice\'s label in a fixed number of queries', function (): void {
    $dishId = (string) $this->world->meal->getKey();
    $options = app(DishOptions::class);
    $count = function () use ($options, $dishId): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $options->forItem($dishId);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };

    dishChoice($this->world->meal, (string) choiceRecipe($this->organisationId, 'egg')->getKey(), 'Aioli');
    $one = $count();

    dishChoice($this->world->meal, (string) choiceRecipe($this->organisationId, 'milk')->getKey(), 'Ranch');
    dishChoice($this->world->meal, (string) choiceRecipe($this->organisationId, null)->getKey(), 'Salsa');

    expect($count())->toBe($one);
});

it('refuses a held line whose sauce lost its assessment, on the amendment path too', function (): void {
    $sauce = choiceRecipe($this->organisationId, 'egg');
    $aioli = dishChoice($this->world->meal, (string) $sauce->getKey());
    $body = choicePickupBody($this, [$aioli], [
        'fulfilment_type' => 'delivery',
        'payment_method' => 'cash_on_delivery',
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ]);

    $placed = $this->postJson('/api/v1/catalogue/order-desk/orders', $body, $this->headers + ['Idempotency-Key' => 'held-sauce'])
        ->assertCreated();
    $order = Order::query()->findOrFail($placed->json('data.order.id'));

    // The sauce's recipe goes back for review after a recompute: no published basis.
    RecipeVersion::withoutTenancy()->where('recipe_id', $sauce->getKey())->update(['status' => 'review_required']);

    $dishId = (string) $this->world->meal->getKey();
    expect(app(DishOptions::class)->snapshot($dishId, [$aioli]))->toBeNull()
        ->and(app(DishOptions::class)->refusal($dishId, [$aioli]))->toBe('item_not_assessed')
        ->and(app(DishOptions::class)->allergensOf([$aioli])['assessed'])->toBeFalse();

    // The order already holds the dish, so its own assessment is waived; the
    // sauce's is not, or the line would be saved with the dish's allergens alone.
    $this->patchJson(
        "/api/v1/catalogue/order-desk/orders/{$order->getKey()}",
        ['lines' => $body['lines']],
        $this->headers + ['If-Match' => '"'.$order->refresh()->lock_version.'"'],
    )->assertStatus(409)
        ->assertJsonPath('error.details.reasons.0.reason', 'item_not_assessed');

    $this->postJson('/api/v1/catalogue/order-desk/quote', [
        'fulfilment_type' => 'delivery',
        'amending_order_id' => (string) $order->getKey(),
        'lines' => $body['lines'],
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.quote.quotable', false);

    expect($order->lines()->sole()->allergens)->toEqual([['allergen_code' => 'egg', 'containment' => 'contains']]);
});

it('counts an excluded ingredient in the chosen sauce\'s recipe as on the meal', function (): void {
    $sauce = choiceRecipe($this->organisationId, null);
    $aioli = dishChoice($this->world->meal, (string) $sauce->getKey());
    $garlic = Ingredient::withoutTenancy()->findOrFail(RecipeVersionLine::withoutTenancy()
        ->whereIn('recipe_version_id', RecipeVersion::withoutTenancy()->where('recipe_id', $sauce->getKey())->select('id'))
        ->value('ingredient_id'));

    $profile = CustomerDietaryProfile::query()->where('customer_account_id', $this->account->getKey())->firstOrFail();
    CustomerFoodExclusion::factory()->forIngredient($garlic)->forbidden()->create(['customer_dietary_profile_id' => $profile->getKey()]);

    $safety = app(MealSafetyService::class);
    $mealId = (string) $this->world->meal->getKey();

    expect($safety->check($this->account, $mealId)['safe'])->toBeTrue()
        ->and($safety->check($this->account, $mealId, [$aioli]))->toBe(['safe' => false, 'allergen_classes' => [], 'reason' => 'excluded']);
});

describe('the kitchen\'s editor', function (): void {
    beforeEach(function (): void {
        $this->kitchen = CatalogueWorld::kitchen('choice-editor@catalogue.test');
        $this->dish = CatalogueItem::factory()->meal()->published()->create([
            'catalogue_id' => $this->kitchen->catalogue->getKey(),
            'organisation_id' => $this->kitchen->organisation->getKey(),
            'allergens_assessed_at' => now(),
        ]);
        $this->url = '/api/v1/catalogue/items/'.$this->dish->getKey().'/options';
        $this->sauce = ['kind' => 'choice', 'group_en' => 'Sauce', 'group_ar' => 'صلصة', 'name_en' => 'Aioli', 'name_ar' => 'أيولي'];
        $this->actingAs($this->kitchen->user);
    });

    it('refuses a choice with no recipe, and one of another kitchen\'s', function (): void {
        $theirs = choiceRecipe((string) $this->world->organisation->getKey(), 'egg');

        $missing = $this->putJson($this->url, ['options' => [$this->sauce]], CatalogueWorld::headers($this->kitchen))
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'validation.failed');

        expect(array_keys($missing->json('error.details.fields')))->toContain('options.0.recipe_id');

        $this->putJson($this->url, ['options' => [[...$this->sauce, 'recipe_id' => (string) $theirs->getKey()]]], CatalogueWorld::headers($this->kitchen))
            ->assertUnprocessable();

        expect(CatalogueItemOption::withoutTenancy()->where('catalogue_item_id', $this->dish->getKey())->count())->toBe(0);
    });

    it('saves a linked choice with its recipe\'s allergens, and no longer clears the dish\'s stamp', function (): void {
        $aioli = choiceRecipe((string) $this->kitchen->organisation->getKey(), 'egg');

        $this->putJson($this->url, ['options' => [[...$this->sauce, 'recipe_id' => (string) $aioli->getKey()]]], CatalogueWorld::headers($this->kitchen))
            ->assertOk()
            ->assertJsonPath('data.options.0.recipe_id', (string) $aioli->getKey())
            ->assertJsonPath('data.options.0.allergens.0.allergen_code', 'egg');

        expect($this->dish->refresh()->allergens_assessed_at)->not->toBeNull();

        $this->getJson($this->url, CatalogueWorld::headers($this->kitchen))
            ->assertOk()
            ->assertJsonPath('data.options.0.allergens.0.allergen_code', 'egg');
    });

    it('shows an unlinked choice to the kitchen, with no allergens', function (): void {
        dishChoice($this->dish, null, 'Garlic');

        $this->getJson($this->url, CatalogueWorld::headers($this->kitchen))
            ->assertOk()
            ->assertJsonPath('data.options.0.recipe_id', null)
            ->assertJsonPath('data.options.0.allergens', null);
    });
});
