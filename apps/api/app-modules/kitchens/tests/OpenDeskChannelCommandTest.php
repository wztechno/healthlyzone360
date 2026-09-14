<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| kitchen:open-desk-channel
|--------------------------------------------------------------------------
|
| The command carries the backfill migrations' own SQL, scoped to one kitchen,
| and `DeskChannelBackfillTest` already proves that SQL copies the right columns
| and prices a counter line exactly as the web shop prices it. What is new here
| — and all this suite asserts — is the wrapper: **the named kitchen and no
| other**, and **a second run that adds nothing**, because unlike a migration
| this is meant to be run again whenever a channels or tariff restatement has
| dropped the desk.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('open-desk@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->shop = PricingWorld::channel($this->organisation, 'web-shop');
});

it('opens the named kitchens counter, mirrors the web shop onto it, and repeats without duplicating', function (): void {
    $neighbour = PricingWorld::kitchen('open-desk-neighbour@kitchen.test');
    PricingWorld::channel($neighbour->organisation, 'web-shop');

    ChannelCatalogueItem::withoutTenancy()->create([
        'organisation_id' => (string) $this->organisation->getKey(),
        'sales_channel_id' => (string) $this->shop->getKey(),
        'catalogue_item_id' => (string) PricingWorld::meal($this->tenant)->getKey(),
        'is_available' => true,
    ]);

    PricingWorld::assign($this->shop, PricingWorld::priceList($this->organisation, 'menu-usd', active: true));

    $this->artisan('kitchen:open-desk-channel', ['--org' => $this->organisation->slug])->assertSuccessful();
    $this->artisan('kitchen:open-desk-channel', ['--org' => $this->organisation->slug])->assertSuccessful();

    $desk = SalesChannel::withoutTenancy()
        ->where('organisation_id', $this->organisation->getKey())
        ->where('code', 'desk')
        ->sole();

    expect($desk->channel_kind)->toBe(SalesChannelKind::Pos)
        ->and($desk->status)->toBe(SalesChannelStatus::Active)
        ->and($desk->order_source)->toBe('desk')
        ->and(ChannelCatalogueItem::withoutTenancy()->where('sales_channel_id', $desk->getKey())->count())->toBe(1)
        ->and(ChannelPriceList::withoutTenancy()->where('sales_channel_id', $desk->getKey())->count())->toBe(1);

    // One kitchen was named, so one counter opened. The migrations this command
    // replaces were deliberately platform-wide; a repair run against a live
    // installation must not be.
    expect(SalesChannel::withoutTenancy()
        ->where('organisation_id', $neighbour->organisation->getKey())
        ->where('code', 'desk')
        ->exists())->toBeFalse();
});

it('refuses, rather than opening an empty counter, when the kitchen has no web shop', function (): void {
    $this->shop->forceFill(['code' => 'marketplace'])->save();

    $this->artisan('kitchen:open-desk-channel', ['--org' => $this->organisation->slug])->assertFailed();

    expect(SalesChannel::withoutTenancy()
        ->where('organisation_id', $this->organisation->getKey())
        ->where('code', 'desk')
        ->exists())->toBeFalse();
});
