<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
| An article's B2B and B2C weight and price, edited as one pair on the item:
| the weight is the item's `b2b`/`b2c` pack, the price is that pack's row on
| the list each channel quotes from.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = PricingWorld::kitchen('channel-prices@kitchen.test');
    $this->headers = PricingWorld::headers($this->a);
    $this->meal = PricingWorld::meal($this->a, 'Caramelised onions');

    $this->shop = PricingWorld::channel($this->a->organisation, 'web-shop');
    $this->shop->channel_kind = SalesChannelKind::B2cWeb;
    $this->shop->save();

    $this->wholesale = PricingWorld::channel($this->a->organisation, 'wholesale');
    $this->wholesale->channel_kind = SalesChannelKind::B2b;
    $this->wholesale->save();

    $this->retailList = PricingWorld::priceList($this->a->organisation, 'retail-usd', active: true);
    $this->tradeList = PricingWorld::priceList($this->a->organisation, 'trade-usd', active: true);
    PricingWorld::assign($this->shop, $this->retailList);
    PricingWorld::assign($this->wholesale, $this->tradeList);

    $this->actingAs($this->a->user);

    $this->url = '/api/v1/catalogue/items/'.$this->meal->getKey().'/channel-prices';
});

it('sizes and prices a meal on both channels in one write, then reads it back', function (): void {
    $this->getJson($this->url, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.channels.b2b.pack', null)
        ->assertJsonPath('data.channels.b2c.amount_minor', null);

    $this->putJson($this->url, [
        'b2b' => ['quantity' => 1, 'unit' => 'kg', 'amount_minor' => 1200],
        'b2c' => ['quantity' => 0.2, 'unit' => 'kg', 'amount_minor' => 300],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertHeader('ETag', '"1"')
        ->assertJsonPath('data.channels.b2b.pack', ['size' => '1', 'unit' => 'kg'])
        ->assertJsonPath('data.channels.b2b.amount_minor', 1200)
        ->assertJsonPath('data.channels.b2c.pack', ['size' => '0.2', 'unit' => 'kg'])
        ->assertJsonPath('data.channels.b2c.amount_minor', 300)
        ->assertJsonPath('data.channels.b2c.price_list_id', (string) $this->retailList->getKey());

    $retail = CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->where('code', 'b2c')->sole();

    expect(PriceListItem::withoutTenancy()->where('price_list_id', $this->retailList->getKey())->sole()->catalogue_item_variant_id)
        ->toBe((string) $retail->getKey())
        ->and(CatalogueItemPackVariant::withoutTenancy()->whereKey($retail->getKey())->sole()->net_weight_grams)->toBe(200)
        // Pricing it on a channel is the decision to sell it there.
        ->and(ChannelCatalogueItem::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->count())->toBe(2);
});

it('supersedes a changed price, leaves an unchanged one alone, and withdraws on null', function (): void {
    $this->putJson($this->url, [
        'b2b' => ['quantity' => 1, 'unit' => 'kg', 'amount_minor' => 1200],
        'b2c' => ['quantity' => 0.2, 'unit' => 'kg', 'amount_minor' => 300],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    // B2C repriced and resized; B2B left out entirely.
    $this->putJson($this->url, [
        'b2c' => ['quantity' => 0.25, 'unit' => 'kg', 'amount_minor' => 350],
    ], $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.channels.b2c.pack', ['size' => '0.25', 'unit' => 'kg'])
        ->assertJsonPath('data.channels.b2c.amount_minor', 350)
        ->assertJsonPath('data.channels.b2b.amount_minor', 1200);

    $retailRows = PriceListItem::withoutTenancy()->where('price_list_id', $this->retailList->getKey())->get();
    // Both writes can land in the same second, so the rows are told apart by the supersede link,
    // never by `created_at`.
    $closed = $retailRows->whereNotNull('superseded_by_id');
    $current = $retailRows->whereNull('superseded_by_id');

    expect($retailRows)->toHaveCount(2)
        ->and($closed)->toHaveCount(1)
        ->and($closed->sole()->effective_to)->not->toBeNull()
        ->and($closed->sole()->superseded_by_id)->toBe((string) $current->sole()->getKey())
        ->and(PriceListItem::withoutTenancy()->where('price_list_id', $this->tradeList->getKey())->count())->toBe(1);

    // Stop selling B2B: the price closes, the pack keeps its weight.
    $this->putJson($this->url, ['b2b' => null], $this->headers + ['If-Match' => '"2"'])
        ->assertOk()
        ->assertJsonPath('data.channels.b2b.amount_minor', null)
        ->assertJsonPath('data.channels.b2b.pack', ['size' => '1', 'unit' => 'kg']);
});

it('refuses a stale lock, an unknown unit, and a channel with no price list', function (): void {
    $this->putJson($this->url, [
        'b2c' => ['quantity' => 0.3, 'unit' => 'kg', 'amount_minor' => 300],
    ], $this->headers + ['If-Match' => '"7"'])->assertStatus(409);

    $this->putJson($this->url, [
        'b2c' => ['quantity' => 0.3, 'unit' => 'furlong', 'amount_minor' => 300],
    ], $this->headers + ['If-Match' => '"0"'])->assertStatus(422);

    $this->tradeList->status = PriceListStatus::Archived;
    $this->tradeList->save();

    $this->getJson($this->url, $this->headers)->assertOk()->assertJsonPath('data.channels.b2b', null);

    $this->putJson($this->url, [
        'b2b' => ['quantity' => 1, 'unit' => 'kg', 'amount_minor' => 900],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.details.fields.b2b.0', fn (string $message): bool => str_contains($message, 'price list'));

    expect(PriceListItem::withoutTenancy()->count())->toBe(0);
});
