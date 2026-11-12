<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Jobs\RefreshDishMargins;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackComponent;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\DishMargin;
use Healthy360\Catalogues\Services\DishMargins;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Services\RecipeVersionService;
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
| One row per item × pack × place (plan S7). The costing itself is
| `PackCostTest`'s, so the dish here is one ingredient at a typed price per
| kilo, filled 0.5 kg into a 0.40 bottle: at 6.00 a kilo a pack costs
| 3.00 + 0.40 = 3.40. Its price is a row on the Home shop's (or Business's)
| public tariff. What these hold is what is done with the figure: withheld
| rather than guessed, and an alert only when the cost did the moving.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->tenant = PricingWorld::kitchen('margins@kitchen.test', array_values(array_unique([...PricingWorld::FULL_PERMISSIONS, 'recipe.view_costs_organisation'])));
    $this->tenant->role->forceFill(['code' => 'organisation_owner'])->save();
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

    $organisation = $this->tenant->organisation;

    $this->shop = PricingWorld::channel($organisation, 'web-shop');
    $this->shop->channel_kind = SalesChannelKind::B2cWeb;
    $this->shop->save();
    $this->wholesale = PricingWorld::channel($organisation, 'wholesale');
    $this->wholesale->channel_kind = SalesChannelKind::B2b;
    $this->wholesale->save();

    $this->retailList = PricingWorld::priceList($organisation, 'retail-usd', active: true);
    $this->tradeList = PricingWorld::priceList($organisation, 'trade-usd', active: true);
    PricingWorld::assign($this->shop, $this->retailList);
    PricingWorld::assign($this->wholesale, $this->tradeList);

    $this->bottle = RecipeWorld::packagingItem($organisation, 'Bottle 0.5 kg', '0.40', capacity: '0.5');
    $this->jar = RecipeWorld::packagingItem($organisation, 'Jar 1 kg', '0.90', capacity: '1');

    // The dish's one pack: 0.5 kg in the bottle, 5.00 on the Home shop.
    $this->pack = marginPack($this, 'bottle', $this->bottle);
    PricingWorld::price($this->retailList, $this->item, $this->pack, 500);
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

/** An active pack of the dish, filled into `$container` (none: packaging unknown). */
function marginPack(object $test, string $code, ?Ingredient $container, string $fill = '0.5'): CatalogueItemVariant
{
    $variant = CatalogueItemVariant::withoutTenancy()->create([
        'organisation_id' => $test->orgId,
        'catalogue_item_id' => $test->item->getKey(),
        'variant_type' => 'pack',
        'code' => $code,
        'name_en' => $container?->name_en,
        'is_default' => $code === 'bottle',
        'status' => 'active',
        'lock_version' => 0,
    ]);

    $size = new CatalogueItemPackVariant;
    $size->catalogue_item_variant_id = (string) $variant->getKey();
    $size->organisation_id = $test->orgId;
    $size->pack_quantity = $fill;
    $size->pack_unit_id = RecipeWorld::unit('kg');
    $size->save();

    if ($container !== null) {
        $component = new CatalogueItemPackComponent;
        $component->organisation_id = $test->orgId;
        $component->catalogue_item_variant_id = (string) $variant->getKey();
        $component->ingredient_id = (string) $container->getKey();
        $component->quantity = '1';
        $component->is_container = true;
        $component->save();
    }

    return $variant;
}

function refreshMargins(object $test): DishMargin
{
    app(DishMargins::class)->refresh($test->orgId);

    return DishMargin::withoutTenancy()->sole();
}

/**
 * @return array<string, string|null> `pack code|place` → margin
 */
function marginsByPackAndPlace(): array
{
    $codes = CatalogueItemVariant::withoutTenancy()->pluck('code', 'id');

    return DishMargin::withoutTenancy()->get()
        ->mapWithKeys(static fn (DishMargin $row): array => [($codes[$row->catalogue_item_variant_id] ?? '-').'|'.$row->channel => $row->margin_percent])
        ->sortKeys()
        ->all();
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

it('works out a margin per pack from its price on the tariff and what the pack costs', function (): void {
    costedAt($this, '6.000000');

    expect(refreshMargins($this))
        ->catalogue_item_variant_id->toBe((string) $this->pack->getKey())
        ->pack_label->toBe('Bottle 0.5 kg')
        ->channel->toBe('home')
        ->price_amount->toBe('5.000000')
        ->contents_amount->toBe('3.000000')
        ->cost_amount->toBe('3.400000')
        ->currency_code->toBe('USD')
        // (5.00 − 3.40) ÷ 5.00
        ->margin_percent->toBe('32.00')
        ->withheld_reason->toBeNull();
});

it('writes one row per pack per place it is priced on, and none where it is not', function (): void {
    costedAt($this, '6.000000');
    PricingWorld::price($this->tradeList, $this->item, $this->pack, 800);

    // 1 kg in the jar: 6.00 + 0.90 = 6.90 a pack, sold only on the Home shop.
    $jar = marginPack($this, 'jar', $this->jar, '1');
    PricingWorld::price($this->retailList, $this->item, $jar, 1000);

    app(DishMargins::class)->refresh($this->orgId);

    expect(marginsByPackAndPlace())->toBe([
        'bottle|business' => '57.50',
        'bottle|home' => '32.00',
        'jar|home' => '31.00',
    ]);
});

it('takes a price the pack inherits from the item', function (): void {
    costedAt($this, '6.000000');

    $jar = marginPack($this, 'jar', $this->jar, '1');
    PricingWorld::price($this->retailList, $this->item, null, 900);

    app(DishMargins::class)->refresh($this->orgId);

    // The bottle keeps its own 5.00; the jar takes the item's 9.00: (9.00 − 6.90) ÷ 9.00.
    expect(marginsByPackAndPlace())->toBe([
        'bottle|home' => '32.00',
        'jar|home' => '23.33',
    ])->and(DishMargin::withoutTenancy()->where('catalogue_item_variant_id', $jar->getKey())->sole()->price_amount)->toBe('9.000000');
});

it('withholds a pack with no container as packaging_unknown, showing its price and contents', function (): void {
    costedAt($this, '6.000000');
    CatalogueItemPackComponent::withoutTenancy()->delete();

    expect(refreshMargins($this))
        ->price_amount->toBe('5.000000')
        ->contents_amount->toBe('3.000000')
        ->cost_amount->toBeNull()
        ->margin_percent->toBeNull()
        ->withheld_reason->toBe('packaging_unknown');
});

it('withholds an incomplete cost rather than guess', function (): void {
    costedAt($this, null);

    expect(refreshMargins($this))
        ->price_amount->toBe('5.000000')
        ->margin_percent->toBeNull()
        ->withheld_reason->toBe('cost_incomplete');
});

it('withholds a price and a cost in two currencies', function (): void {
    costedAt($this, '6.000000', 'EUR');
    $this->bottle->purchase_price_currency = 'EUR';
    $this->bottle->save();

    expect(refreshMargins($this))
        ->cost_amount->toBe('3.400000')
        ->margin_percent->toBeNull()
        ->withheld_reason->toBe('currency_mismatch');
});

it('withholds a published recipe with no lines, rather than call it free', function (): void {
    RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $this->version->getKey())->delete();

    expect(refreshMargins($this)->withheld_reason)->toBe('cost_incomplete');
});

it('keeps one pack-less row for a dish with no pack, no price or no published recipe', function (): void {
    costedAt($this, '6.000000');

    PriceListItem::withoutTenancy()->delete();
    expect(refreshMargins($this))
        ->catalogue_item_variant_id->toBeNull()
        ->channel->toBe('home')
        ->withheld_reason->toBe('no_price');

    $this->pack->forceFill(['status' => 'archived'])->save();
    expect(refreshMargins($this))
        ->catalogue_item_variant_id->toBeNull()
        ->withheld_reason->toBe('no_pack');

    $this->item->forceFill(['recipe_id' => null])->save();
    expect(refreshMargins($this))
        ->catalogue_item_variant_id->toBeNull()
        ->withheld_reason->toBe('no_recipe');
});

it('alerts the owner once when the cost moves a row below target', function (): void {
    marginTarget($this, 30);

    costedAt($this, '6.000000');
    refreshMargins($this);
    expect(dishAlerts())->toBe(0);

    // 0.5 × 8.00 + 0.40 = 4.40 against 5.00: 12%.
    costedAt($this, '8.000000');
    $row = refreshMargins($this);
    expect(dishAlerts())->toBe(1)->and($row->below_target_since)->not->toBeNull();

    costedAt($this, '8.500000');
    refreshMargins($this);
    expect(dishAlerts())->toBe(1);
});

it('alerts per row: the pack the cost moved below target, not its sibling', function (): void {
    marginTarget($this, 30);
    costedAt($this, '6.000000');

    // Business at 20.00 stays far above target whatever the beef does here.
    PricingWorld::price($this->tradeList, $this->item, $this->pack, 2000);
    app(DishMargins::class)->refresh($this->orgId);

    costedAt($this, '8.000000');
    app(DishMargins::class)->refresh($this->orgId);

    $home = DishMargin::withoutTenancy()->where('channel', 'home')->sole();

    expect(dishAlerts())->toBe(1)
        ->and(StaffNotification::withoutTenancy()->where('type', StaffAlertType::DishBelowTarget->value)->pluck('subject_id')->unique()->values()->all())->toBe([(string) $home->getKey()])
        ->and(DishMargin::withoutTenancy()->where('channel', 'business')->sole()->below_target_since)->toBeNull();
});

it('alerts again after a row recovers and falls', function (): void {
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

it('brings an item current after a packs save, with no nightly run', function (): void {
    costedAt($this, '6.000000');

    $jar = marginPack($this, 'jar', $this->jar, '1');
    PricingWorld::price($this->retailList, $this->item, $jar, 1000);
    app(DishMargins::class)->refresh($this->orgId);
    expect(DishMargin::withoutTenancy()->count())->toBe(2);

    // The bottle's Home shop price moves to 6.00; the jar's is cleared.
    $pack = fn (CatalogueItemVariant $variant, Ingredient $container, string $fill, ?int $home): array => [
        'id' => (string) $variant->getKey(),
        'fill' => ['quantity' => $fill, 'unit' => 'kg'],
        'components' => [['ingredient_id' => (string) $container->getKey(), 'quantity' => 1, 'is_container' => true]],
        'prices' => ['home' => $home, 'business' => null],
    ];

    $this->putJson(
        '/api/v1/catalogue/items/'.$this->item->getKey().'/packs',
        [
            'places' => ['home' => true, 'business' => false, 'counter' => false],
            'packs' => [$pack($this->pack, $this->bottle, '0.5', 600), $pack($jar, $this->jar, '1', null)],
        ],
        PricingWorld::headers($this->tenant) + ['If-Match' => '"'.CatalogueItem::withoutTenancy()->whereKey($this->item->getKey())->value('lock_version').'"'],
    )->assertOk();

    // (6.00 − 3.40) ÷ 6.00
    expect(DishMargin::withoutTenancy()->sole())
        ->catalogue_item_variant_id->toBe((string) $this->pack->getKey())
        ->channel->toBe('home')
        ->price_amount->toBe('6.000000')
        ->margin_percent->toBe('43.33');
});

it('serves the list, lowest first, with the pack, the place and the flag read against the target as it stands', function (): void {
    costedAt($this, '8.000000');
    refreshMargins($this);
    marginTarget($this, 30);

    $this->getJson('/api/v1/catalogue/reports/dish-margins', PricingWorld::headers($this->tenant))
        ->assertOk()
        ->assertJsonPath('data.target_percent', 30)
        ->assertJsonPath('data.dishes.0.place', 'home')
        ->assertJsonPath('data.dishes.0.pack', [
            'catalogue_item_variant_id' => (string) $this->pack->getKey(),
            'label' => 'Bottle 0.5 kg',
            'fill' => ['quantity' => '0.5', 'unit' => 'kg'],
        ])
        ->assertJsonPath('data.dishes.0.price_amount', '5.000000')
        ->assertJsonPath('data.dishes.0.contents_amount', '4.000000')
        ->assertJsonPath('data.dishes.0.cost_amount', '4.400000')
        ->assertJsonPath('data.dishes.0.margin_percent', '12.00')
        ->assertJsonPath('data.dishes.0.is_below_target', true);
});

it('names the kind each dish is sold as, so its row opens the right recipe', function (): void {
    $this->item->forceFill(['item_type' => CatalogueItemType::Sauce])->save();
    costedAt($this, '8.000000');
    refreshMargins($this);

    $this->getJson('/api/v1/catalogue/reports/dish-margins', PricingWorld::headers($this->tenant))
        ->assertOk()
        ->assertJsonPath('data.dishes.0.catalogue_item_id', (string) $this->item->getKey())
        ->assertJsonPath('data.dishes.0.item_type', 'sauce');
});

it('is closed to a member without the cost code', function (): void {
    $cook = PricingWorld::kitchen('cook@kitchen.test', ['recipe.view_organisation']);

    forgetResolvedGuards();
    $this->actingAs($cook->user);

    $this->getJson('/api/v1/catalogue/reports/dish-margins', PricingWorld::headers($cook))->assertForbidden();
});

it('brings a dish current when a new version of its recipe is published, with no nightly run', function (): void {
    costedAt($this, '6.000000');
    expect(DishMargin::withoutTenancy()->count())->toBe(0);

    app(DatabaseTenantContext::class)->apply(null, $this->orgId, null);

    try {
        $versions = app(RecipeVersionService::class);
        $draft = $versions->newDraft(Recipe::withoutTenancy()->whereKey($this->item->recipe_id)->sole(), $this->version);
        $versions->publish($draft, $draft->lock_version, applySellingRule: false);
    } finally {
        app(DatabaseTenantContext::class)->reset();
    }

    // (5.00 − 3.40) ÷ 5.00, read off the version just published.
    expect(DishMargin::withoutTenancy()->sole())
        ->catalogue_item_id->toBe((string) $this->item->getKey())
        ->catalogue_item_variant_id->toBe((string) $this->pack->getKey())
        ->margin_percent->toBe('32.00');
});

it('runs every trading kitchen from the schedule', function (): void {
    costedAt($this, '6.000000');

    (new RefreshDishMargins)->handle(app(DatabaseTenantContext::class), app(TenantContext::class), app(DishMargins::class));

    expect(DishMargin::withoutTenancy()->count())->toBe(1);
});
