<?php

declare(strict_types=1);

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Customers\Enums\AllergenSeverity;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A one-off order hears the allergen rule subscriptions already obey
|--------------------------------------------------------------------------
|
| The world's meal has no recipe, so `DerivedAllergenService` reports
| `basis = none` for it — "not assessed". For a customer who has declared an
| allergy that is a conflict (`unassessed`), the same verdict `MealSafety`
| gives subscription generation. The preview names it; placement refuses it
| until the customer says they saw it, and re-reads the declarations rather
| than trusting the preview.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('allergen-checkout@kitchen.test');
    $this->shopper = User::query()->whereKey($this->world->customer->account->user_id)->sole();

    $this->declare = function (): void {
        $allergen = Allergen::factory()->create(['code' => 'peanuts']);

        $profile = CustomerDietaryProfile::query()
            ->where('customer_account_id', $this->world->customer->account->getKey())
            ->firstOrFail();

        $profile->declares_no_allergens = false;
        $profile->save();

        CustomerAllergenDeclaration::query()->create([
            'customer_dietary_profile_id' => $profile->getKey(),
            'allergen_code' => $allergen->code,
            'severity' => AllergenSeverity::Allergy,
            'declared_at' => CarbonImmutable::now(),
        ]);
    };
});

function allergenBasket(object $world): Cart
{
    $carts = app(CartService::class);

    $cart = $carts->getOrCreate($world->customer->account, $world->channel);
    $carts->addItem($cart, (string) $world->meal->getKey(), quantity: 1);

    return $cart->refresh();
}

it('reports no conflict for a customer who has declared nothing', function (): void {
    $this->actingAs($this->shopper);

    $cart = allergenBasket($this->world);

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.warnings', [])
        ->assertJsonPath('data.preview.allergen_conflicts', []);
});

it('names the clashing meal on the preview', function (): void {
    ($this->declare)();
    $this->actingAs($this->shopper);

    $cart = allergenBasket($this->world);

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.warnings', ['allergen_conflict'])
        ->assertJsonPath('data.preview.allergen_conflicts', [[
            'catalogue_item_id' => (string) $this->world->meal->getKey(),
            'reason' => 'unassessed',
            'allergen_codes' => [],
        ]]);
});

it('refuses placement until the conflict is acknowledged, then places', function (): void {
    ($this->declare)();
    $this->actingAs($this->shopper);

    $cart = allergenBasket($this->world);
    $body = [
        'cart_id' => (string) $cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ];

    $this->postJson('/api/v1/orders', $body, firstPartyHeaders())
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'order.placement_refused')
        ->assertJsonPath('error.details.reasons.0.reason', 'allergen_conflict')
        ->assertJsonPath('error.details.reasons.0.catalogue_item_id', (string) $this->world->meal->getKey())
        ->assertJsonPath('error.details.reasons.0.cause', 'unassessed');

    expect(Order::query()->count())->toBe(0);

    $this->postJson('/api/v1/orders', [...$body, 'acknowledge_allergen_conflicts' => true], firstPartyHeaders())
        ->assertCreated();

    expect(Order::query()->count())->toBe(1);
});

it('answers a configurator with the same verdict', function (): void {
    ($this->declare)();
    $this->actingAs($this->shopper);

    $mealId = (string) $this->world->meal->getKey();

    $this->getJson('/api/v1/me/allergen-conflicts?meal_ids='.$mealId, firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.conflicts', [[
            'catalogue_item_id' => $mealId,
            'reason' => 'unassessed',
            'allergen_codes' => [],
        ]]);

    $this->getJson('/api/v1/me/allergen-conflicts?meal_ids=not-a-uuid', firstPartyHeaders())
        ->assertStatus(422);
});
