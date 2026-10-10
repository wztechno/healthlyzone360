<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Database\Seeders\ProductCategorySeeder;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| kitchen:price-frozen-shelf
|--------------------------------------------------------------------------
|
| The v6 import publishes the frozen shelf unpriced and on no channel, so the
| marketplace hides it. What has to hold: a frozen item the price file names is
| priced on the retail tariff and offered on the web shop; the tariff's other
| prices survive the set-replace untouched; an item the file does not name
| stays hidden; a re-run adds nothing; and a dry run writes nothing.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class, ProductCategorySeeder::class]);

    config()->set('kitchens.import.environments', ['local', 'testing']);

    $this->tenant = PricingWorld::kitchen('frozen-shelf@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->shop = PricingWorld::channel($this->organisation, 'web-shop');
    $this->tariff = PricingWorld::priceList($this->organisation, 'healthy360-b2c-usd', active: true);
    PricingWorld::assign($this->shop, $this->tariff);

    $frozen = ProductCategory::withoutTenancy()->whereNull('organisation_id')->where('code', 'frozen')->sole();

    $frozenProduct = function (string $slug, string $name) use ($frozen): object {
        $product = PricingWorld::product($this->tenant, $name, 'unit');
        $product->item->forceFill(['slug' => $slug, 'product_category_id' => $frozen->getKey()])->save();

        return $product;
    };

    $this->fries = $frozenProduct('french-fries-frozen', 'French fries, frozen');
    $this->unnamed = $frozenProduct('mystery-frozen-pack', 'Mystery frozen pack');

    $this->meal = PricingWorld::meal($this->tenant);
    $this->mealPrice = PricingWorld::price($this->tariff, $this->meal, amountMinor: 950);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

it('prices the named frozen items on the retail tariff and lists them on the web shop, once', function (): void {
    $this->artisan('kitchen:price-frozen-shelf', ['--org' => $this->organisation->slug])->assertSuccessful();
    $this->artisan('kitchen:price-frozen-shelf', ['--org' => $this->organisation->slug])->assertSuccessful();

    $friesPrices = PriceListItem::withoutTenancy()->where('catalogue_item_id', $this->fries->item->getKey())->get();

    expect($friesPrices)->toHaveCount(1)
        ->and($friesPrices->sole()->unit_amount_minor)->toBe(125)
        ->and($friesPrices->sole()->catalogue_item_variant_id)->toBe((string) $this->fries->variant->getKey())
        ->and($friesPrices->sole()->effective_to)->toBeNull();

    $listing = ChannelCatalogueItem::withoutTenancy()->where('catalogue_item_id', $this->fries->item->getKey())->sole();

    expect($listing->sales_channel_id)->toBe((string) $this->shop->getKey())
        ->and($listing->catalogue_item_variant_id)->toBe((string) $this->fries->variant->getKey())
        ->and($listing->is_available)->toBeTrue();

    // The set-replace restated the meal's standing price rather than withdrawing it.
    $mealRows = PriceListItem::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->get();

    expect($mealRows)->toHaveCount(1)
        ->and($mealRows->sole()->getKey())->toBe($this->mealPrice->getKey())
        ->and($mealRows->sole()->effective_to)->toBeNull();

    // Not in the price file: no invented price, so it stays off the shelf.
    expect(PriceListItem::withoutTenancy()->where('catalogue_item_id', $this->unnamed->item->getKey())->exists())->toBeFalse()
        ->and(ChannelCatalogueItem::withoutTenancy()->where('catalogue_item_id', $this->unnamed->item->getKey())->exists())->toBeFalse();
});

it('writes nothing on a dry run', function (): void {
    $this->artisan('kitchen:price-frozen-shelf', ['--org' => $this->organisation->slug, '--dry-run' => true])->assertSuccessful();

    expect(PriceListItem::withoutTenancy()->where('catalogue_item_id', $this->fries->item->getKey())->exists())->toBeFalse()
        ->and(ChannelCatalogueItem::withoutTenancy()->where('catalogue_item_id', $this->fries->item->getKey())->exists())->toBeFalse();
});

it('refuses when the kitchen has no web shop to sell through', function (): void {
    $this->shop->forceFill(['code' => 'marketplace'])->save();

    $this->artisan('kitchen:price-frozen-shelf', ['--org' => $this->organisation->slug])->assertFailed();

    expect(PriceListItem::withoutTenancy()->where('catalogue_item_id', $this->fries->item->getKey())->exists())->toBeFalse();
});
