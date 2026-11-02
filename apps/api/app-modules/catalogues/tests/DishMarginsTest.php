<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Jobs\RefreshDishMargins;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\DishMargin;
use Healthy360\Catalogues\Services\DishMargins;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\Mail;

/*
|--------------------------------------------------------------------------
| Dish margins and the below-target alert
|--------------------------------------------------------------------------
|
| The costing itself is `WeeklyRecipeCostingTest`'s, so the dish here is one
| ingredient at a typed price per kilo, and each test sets that price. What these
| hold is what is done with the figure: withheld rather than guessed, and an alert
| only when the cost did the moving.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->tenant = PricingWorld::kitchen('margins@kitchen.test', ['recipe.view_costs_organisation']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->actingAs($this->tenant->user);

    app(TenantContext::class)->setOrganisation((string) $this->tenant->user->getKey(), $this->orgId);

    $recipe = Recipe::factory()->create(['organisation_id' => $this->orgId]);
    $this->beef = RecipeWorld::verifiedCleanIngredient($this->tenant->organisation, 'Beef');
    $this->beef->default_unit_id = RecipeWorld::unit('kg');
    $this->beef->purchase_unit_id = null;
    $this->beef->save();

    $this->version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->orgId,
        'status' => RecipeVersionStatus::Published,
        'yield_quantity' => '1',
        'yield_unit_id' => RecipeWorld::unit('kg'),
        'waste_coefficient_percent' => '0',
        'b2c_price_amount' => '10.000000',
        'b2b_price_amount' => null,
        'price_currency_code' => 'USD',
    ]);
    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $this->version->getKey(),
        'organisation_id' => $this->orgId,
        'ingredient_id' => $this->beef->getKey(),
        'line_number' => 1,
        'quantity' => '1',
        'unit_id' => RecipeWorld::unit('kg'),
    ]);

    $this->item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => Catalogue::factory()->create(['organisation_id' => $this->orgId])->getKey(),
        'organisation_id' => $this->orgId,
        'recipe_id' => $recipe->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/** The dish's one ingredient at this price, so the live cost per kilo is exactly it. */
function costedAt(object $test, ?string $total, string $currency = 'USD'): void
{
    $test->beef->purchase_price_amount = $total;
    $test->beef->purchase_price_currency = $total === null ? null : $currency;
    $test->beef->save();
}

function refreshMargins(object $test): DishMargin
{
    app(DishMargins::class)->refresh($test->orgId);

    return DishMargin::withoutTenancy()->sole();
}

function marginTarget(object $test, ?int $percent): void
{
    $settings = app(KitchenServiceSettingsLookup::class)->for($test->orgId);
    $settings->dish_margin_target_percent = $percent;
    $settings->save();
}

function dishAlerts(): int
{
    return StaffNotification::withoutTenancy()->where('type', StaffAlertType::DishBelowTarget->value)->count();
}

it('works out a margin from the list price and the live cost', function (): void {
    costedAt($this, '6.000000');

    expect(refreshMargins($this))
        ->margin_percent->toBe('40.00')
        ->withheld_reason->toBeNull();
});

it('withholds the margin, with a reason, rather than guess', function (?string $cost, ?string $currency, string $reason): void {
    costedAt($this, $cost, $currency);

    expect(refreshMargins($this))
        ->margin_percent->toBeNull()
        ->withheld_reason->toBe($reason);
})->with([
    'an unpriced ingredient' => [null, 'USD', 'cost_incomplete'],
    'two currencies' => ['6.000000', 'EUR', 'currency_mismatch'],
]);

it('withholds a published recipe with no lines, rather than call it free', function (): void {
    RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $this->version->getKey())->delete();

    expect(refreshMargins($this)->withheld_reason)->toBe('cost_incomplete');
});

it('withholds a dish with no list price, and a dish with no published recipe', function (): void {
    costedAt($this, '6.000000');

    $this->version->forceFill(['b2c_price_amount' => null])->save();
    expect(refreshMargins($this)->withheld_reason)->toBe('no_price');

    $this->item->forceFill(['recipe_id' => null])->save();
    expect(refreshMargins($this)->withheld_reason)->toBe('no_recipe');
});

it('writes one row per channel the dish is priced on', function (): void {
    costedAt($this, '6.000000');
    $this->version->forceFill(['b2b_price_amount' => '8.000000'])->save();

    app(DishMargins::class)->refresh($this->orgId);

    expect(DishMargin::withoutTenancy()->orderBy('channel')->pluck('margin_percent', 'channel')->all())
        ->toBe(['b2b' => '25.00', 'b2c' => '40.00']);
});

it('alerts the owner once when the cost moves a dish below target', function (): void {
    marginTarget($this, 30);

    costedAt($this, '6.000000');
    refreshMargins($this);
    expect(dishAlerts())->toBe(0);

    costedAt($this, '8.000000');
    $row = refreshMargins($this);
    expect(dishAlerts())->toBe(1)->and($row->below_target_since)->not->toBeNull();

    costedAt($this, '8.500000');
    refreshMargins($this);
    expect(dishAlerts())->toBe(1);
});

it('alerts again after a dish recovers and falls', function (): void {
    marginTarget($this, 30);

    costedAt($this, '6.000000');
    refreshMargins($this);
    costedAt($this, '8.000000');
    refreshMargins($this);
    costedAt($this, '6.000000');
    expect(refreshMargins($this)->below_target_since)->toBeNull();

    costedAt($this, '8.000000');
    refreshMargins($this);

    expect(StaffNotification::withoutTenancy()->where('type', StaffAlertType::DishBelowTarget->value)->whereNull('read_at')->exists())->toBeTrue();
});

it('flags without alerting when the target moved and the cost did not', function (): void {
    costedAt($this, '8.000000');
    refreshMargins($this);

    marginTarget($this, 30);
    $row = refreshMargins($this);

    expect($row->below_target_since)->not->toBeNull()->and(dishAlerts())->toBe(0);
});

it('stays silent with no target, and leaves the mark alone while a cost is unknown', function (): void {
    costedAt($this, '6.000000');
    refreshMargins($this);
    costedAt($this, '9.000000');
    refreshMargins($this);
    expect(dishAlerts())->toBe(0);

    marginTarget($this, 30);
    $marked = refreshMargins($this)->below_target_since;
    costedAt($this, null);

    expect(refreshMargins($this)->below_target_since)->toEqual($marked);
});

it('takes a dish off the page when it comes off sale', function (): void {
    costedAt($this, '6.000000');
    refreshMargins($this);

    $this->item->forceFill(['status' => CatalogueItemStatus::Retired])->save();
    app(DishMargins::class)->refresh($this->orgId);

    expect(DishMargin::withoutTenancy()->count())->toBe(0);
});

it('serves the list, lowest first, with the flag read against the target as it stands', function (): void {
    costedAt($this, '8.000000');
    refreshMargins($this);
    marginTarget($this, 30);

    $this->getJson('/api/v1/catalogue/reports/dish-margins', PricingWorld::headers($this->tenant))
        ->assertOk()
        ->assertJsonPath('data.target_percent', 30)
        ->assertJsonPath('data.dishes.0.margin_percent', '20.00')
        ->assertJsonPath('data.dishes.0.is_below_target', true);
});

it('is closed to a member without the cost code', function (): void {
    $cook = PricingWorld::kitchen('cook@kitchen.test', ['recipe.view_organisation']);

    forgetResolvedGuards();
    $this->actingAs($cook->user);

    $this->getJson('/api/v1/catalogue/reports/dish-margins', PricingWorld::headers($cook))->assertForbidden();
});

it('runs every trading kitchen from the schedule', function (): void {
    costedAt($this, '6.000000');

    (new RefreshDishMargins)->handle(app(DatabaseTenantContext::class), app(TenantContext::class), app(DishMargins::class));

    expect(DishMargin::withoutTenancy()->count())->toBe(1);
});
