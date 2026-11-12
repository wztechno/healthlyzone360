<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Models\CatalogueItemPackComponent;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Services\SellingReadiness;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
| The Packs & prices tab's one write: packs, their packaging, both prices and
| the three places, against one item lock.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = PricingWorld::kitchen('item-packs@kitchen.test');
    $this->headers = PricingWorld::headers($this->a);
    $organisation = $this->a->organisation;
    $this->meal = PricingWorld::meal($this->a, 'Tahini sauce');

    $this->shop = PricingWorld::channel($organisation, 'web-shop');
    $this->shop->channel_kind = SalesChannelKind::B2cWeb;
    $this->shop->save();

    $this->wholesale = PricingWorld::channel($organisation, 'wholesale');
    $this->wholesale->channel_kind = SalesChannelKind::B2b;
    $this->wholesale->save();

    $this->desk = PricingWorld::channel($organisation, 'desk');
    $this->desk->channel_kind = SalesChannelKind::Pos;
    $this->desk->save();

    $this->retailList = PricingWorld::priceList($organisation, 'retail-usd', active: true);
    $this->tradeList = PricingWorld::priceList($organisation, 'trade-usd', active: true);
    PricingWorld::assign($this->shop, $this->retailList);
    PricingWorld::assign($this->desk, $this->retailList);
    PricingWorld::assign($this->wholesale, $this->tradeList);

    $this->bottle = RecipeWorld::packagingItem($organisation, 'Bottle 0.5 L', '0.40', capacity: '0.5');
    $this->bottle->source_ref = 'BTL-500';
    $this->bottle->save();
    $this->jar = RecipeWorld::packagingItem($organisation, 'Jar 1 L', '0.90', capacity: '1');
    $this->cap = RecipeWorld::packagingItem($organisation, 'Cap', '0.05');
    $this->label = RecipeWorld::packagingItem($organisation, 'Label', '0.02');

    $this->actingAs($this->a->user);

    $this->url = '/api/v1/catalogue/items/'.$this->meal->getKey().'/packs';

    $this->pack = fn (?string $id, Ingredient $container, array $extras, ?int $home, ?int $business, float $fill = 0.5): array => [
        'id' => $id,
        'fill' => ['quantity' => $fill, 'unit' => 'kg'],
        'components' => [
            ['ingredient_id' => (string) $container->getKey(), 'quantity' => 1, 'is_container' => true],
            ...array_map(static fn (Ingredient $extra): array => ['ingredient_id' => (string) $extra->getKey(), 'quantity' => 1, 'is_container' => false], $extras),
        ],
        'prices' => ['home' => $home, 'business' => $business],
    ];

    $this->places = fn (bool $home = true, bool $business = true, bool $counter = true): array => compact('home', 'business', 'counter');

    $this->put = fn (array $body, int $lock) => $this->putJson($this->url, $body, $this->headers + ['If-Match' => '"'.$lock.'"']);

    $this->packsOf = fn () => CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->get()->keyBy('code');
});

it('writes two packs with their packaging and both prices in one write, and reads them back', function (): void {
    ($this->put)(['places' => ($this->places)(), 'packs' => [
        ($this->pack)(null, $this->bottle, [$this->cap, $this->label], 600, 450),
        ($this->pack)(null, $this->jar, [$this->cap], 1100, 800, 1),
    ]], 0)
        ->assertOk()
        ->assertHeader('ETag', '"1"')
        ->assertJsonPath('data.lock_version', 1)
        ->assertJsonPath('data.places.home.offered', true)
        ->assertJsonPath('data.places.business.price_list_id', (string) $this->tradeList->getKey())
        ->assertJsonPath('data.places.counter.follows_home', true)
        ->assertJsonPath('data.places.counter.offered', true)
        ->assertJsonCount(2, 'data.packs');

    $this->getJson($this->url, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.packs.0.code', 'btl-500')
        ->assertJsonPath('data.packs.0.name_en', 'Bottle 0.5 L')
        ->assertJsonPath('data.packs.0.is_default', true)
        ->assertJsonPath('data.packs.0.fill', ['quantity' => '0.5', 'unit' => 'kg'])
        ->assertJsonPath('data.packs.0.components.0', ['ingredient_id' => (string) $this->bottle->getKey(), 'quantity' => '1', 'is_container' => true])
        ->assertJsonCount(3, 'data.packs.0.components')
        ->assertJsonPath('data.packs.0.prices', ['home' => ['amount_minor' => 600, 'inherited' => false], 'business' => ['amount_minor' => 450, 'inherited' => false]])
        ->assertJsonPath('data.packs.1.is_default', false)
        ->assertJsonPath('data.packs.1.prices.home.amount_minor', 1100)
        ->assertJsonPath('data.packs.1.prices.business.amount_minor', 800);

    $bottlePack = ($this->packsOf)()['btl-500'];

    expect(CatalogueItemPackVariant::withoutTenancy()->whereKey($bottlePack->getKey())->sole()->net_weight_grams)->toBe(500)
        ->and(CatalogueItemPackComponent::withoutTenancy()->count())->toBe(5);
});

it('codes a new pack after its container, names it after it, and makes it the default', function (): void {
    $this->bottle->source_ref = null;
    $this->bottle->save();

    ($this->put)(['places' => ($this->places)(false, false, false), 'packs' => [
        ($this->pack)(null, $this->bottle, [], null, null),
        ($this->pack)(null, $this->bottle, [], null, null, 0.4),
    ]], 0)->assertOk();

    $packs = CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->orderBy('created_at')->orderBy('id')->get();
    $base = 'pack-'.substr(str_replace('-', '', (string) $this->bottle->getKey()), -8);

    expect($packs->pluck('code')->sort()->values()->all())->toBe([$base, $base.'-2'])
        ->and($packs->every(fn (CatalogueItemVariant $pack): bool => $pack->name_en === 'Bottle 0.5 L'))->toBeTrue()
        ->and($packs->where('is_default', true))->toHaveCount(1);
});

it('makes an inherited price explicit and closes the pack-less row', function (): void {
    ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)(null, $this->bottle, [], null, null)]], 0)->assertOk();
    $pack = ($this->packsOf)()['btl-500'];

    PricingWorld::price($this->retailList, $this->meal, null, 900);

    $this->getJson($this->url, $this->headers)->assertJsonPath('data.packs.0.prices.home', ['amount_minor' => 900, 'inherited' => true]);

    ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)((string) $pack->getKey(), $this->bottle, [], 900, null)]], 1)
        ->assertOk()
        ->assertJsonPath('data.packs.0.prices.home', ['amount_minor' => 900, 'inherited' => false]);

    expect(PriceListItem::withoutTenancy()->where('price_list_id', $this->retailList->getKey())->whereNull('catalogue_item_variant_id')->whereNull('effective_to')->exists())->toBeFalse();
});

it('writes nothing for an unchanged price and withdraws a blank one', function (): void {
    ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)(null, $this->bottle, [], 600, 450)]], 0)->assertOk();
    $id = (string) ($this->packsOf)()['btl-500']->getKey();

    ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)($id, $this->bottle, [], 600, 450)]], 1)->assertOk();

    expect(PriceListItem::withoutTenancy()->count())->toBe(2);

    ($this->put)(['places' => ($this->places)(true, false, true), 'packs' => [($this->pack)($id, $this->bottle, [], 600, null)]], 2)
        ->assertOk()
        ->assertJsonPath('data.packs.0.prices.business', null);

    expect(PriceListItem::withoutTenancy()->count())->toBe(2)
        ->and(PriceListItem::withoutTenancy()->where('price_list_id', $this->tradeList->getKey())->sole()->effective_to)->not->toBeNull();
});

it('archives a pack left out, and hands its default to the first that remains', function (): void {
    ($this->put)(['places' => ($this->places)(false, false, false), 'packs' => [
        ($this->pack)(null, $this->bottle, [], null, null),
        ($this->pack)(null, $this->jar, [], null, null, 1),
    ]], 0)->assertOk();

    $packs = ($this->packsOf)();
    $jarCode = $packs->keys()->first(fn (string $code): bool => $code !== 'btl-500');

    ($this->put)(['places' => ($this->places)(false, false, false), 'packs' => [
        ($this->pack)((string) $packs[$jarCode]->getKey(), $this->jar, [], null, null, 1),
    ]], 1)
        ->assertOk()
        ->assertJsonCount(1, 'data.packs')
        ->assertJsonPath('data.packs.0.is_default', true);

    $after = ($this->packsOf)();

    expect($after['btl-500']->status)->toBe(VariantStatus::Archived)
        ->and($after['btl-500']->is_default)->toBeFalse();
});

it('touches only the item-level offer of each place, and switches it off rather than deleting it', function (): void {
    ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)(null, $this->bottle, [], 600, 450)]], 0)->assertOk();
    $pack = ($this->packsOf)()['btl-500'];

    $other = PricingWorld::channel($this->a->organisation, 'caterer');
    $offer = fn (string $channelId, ?string $variantId, array $extra = []) => ChannelCatalogueItem::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'sales_channel_id' => $channelId,
        'catalogue_item_id' => $this->meal->getKey(),
        'catalogue_item_variant_id' => $variantId,
        'is_available' => true,
    ] + $extra);

    $elsewhere = $offer((string) $other->getKey(), null);
    $perPack = $offer((string) $this->shop->getKey(), (string) $pack->getKey());

    $windowed = ChannelCatalogueItem::withoutTenancy()
        ->where('sales_channel_id', $this->wholesale->getKey())
        ->whereNull('catalogue_item_variant_id')
        ->sole();
    $windowed->available_from = CarbonImmutable::parse('2026-01-01');
    $windowed->available_to = CarbonImmutable::parse('2027-12-31');
    $windowed->save();

    ($this->put)(['places' => ($this->places)(false, true, false), 'packs' => [($this->pack)((string) $pack->getKey(), $this->bottle, [], 600, 450)]], 1)
        ->assertOk()
        ->assertJsonPath('data.places.home.offered', false)
        ->assertJsonPath('data.places.counter.offered', false)
        ->assertJsonPath('data.places.business.offered', true);

    $shopRow = ChannelCatalogueItem::withoutTenancy()->where('sales_channel_id', $this->shop->getKey())->whereNull('catalogue_item_variant_id')->sole();
    $windowed->refresh();

    expect($shopRow->is_available)->toBeFalse()
        ->and($elsewhere->fresh()->is_available)->toBeTrue()
        ->and($perPack->fresh()->is_available)->toBeTrue()
        ->and($windowed->available_from?->toDateString())->toBe('2026-01-01')
        ->and($windowed->available_to?->toDateString())->toBe('2027-12-31')
        ->and(ChannelCatalogueItem::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->count())->toBe(5);
});

it('refuses a container with no capacity, two containers, a non-packaging component and an unknown unit', function (): void {
    $refused = fn (array $pack, string $field) => expect(($this->put)(['places' => ($this->places)(), 'packs' => [$pack]], 0)
        ->assertStatus(422)
        ->json('error.details.fields'))->toHaveKey($field);

    $refused(($this->pack)(null, $this->cap, [], 600, null), 'packs.0.components.0.is_container');

    $two = ($this->pack)(null, $this->bottle, [], 600, null);
    $two['components'][] = ['ingredient_id' => (string) $this->jar->getKey(), 'quantity' => 1, 'is_container' => true];
    $refused($two, 'packs.0.components');

    $food = RecipeWorld::unmappedIngredient($this->a->organisation, 'Chickpeas');
    $withFood = ($this->pack)(null, $this->bottle, [], 600, null);
    $withFood['components'][] = ['ingredient_id' => (string) $food->getKey(), 'quantity' => 1, 'is_container' => false];
    $refused($withFood, 'packs.0.components.1.ingredient_id');

    $furlong = ($this->pack)(null, $this->bottle, [], 600, null);
    $furlong['fill']['unit'] = 'furlong';
    $refused($furlong, 'packs.0.fill.unit');

    expect(CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->count())->toBe(0);
});

it('refuses the counter when the desk quotes from another list', function (): void {
    PricingWorld::assign($this->desk, PricingWorld::priceList($this->a->organisation, 'counter-usd', active: true), priority: -1);

    $fields = ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)(null, $this->bottle, [], 600, null)]], 0)
        ->assertStatus(422)
        ->json('error.details.fields');

    expect($fields)->toHaveKey('places.counter');
});

it('keeps a counter that is already on when the desk has since moved to another list', function (): void {
    ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)(null, $this->bottle, [], 600, null)]], 0)->assertOk();
    $pack = ($this->packsOf)()['btl-500'];

    PricingWorld::assign($this->desk, PricingWorld::priceList($this->a->organisation, 'counter-usd', active: true), priority: -1);

    // Only switching the counter on is refused; one already on is a statement of what stands.
    ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)((string) $pack->getKey(), $this->bottle, [], 650, null)]], 1)
        ->assertOk()
        ->assertJsonPath('data.places.counter.follows_home', false)
        ->assertJsonPath('data.places.counter.offered', true);

    $deskOffer = ChannelCatalogueItem::withoutTenancy()
        ->where('sales_channel_id', $this->desk->getKey())
        ->where('catalogue_item_id', $this->meal->getKey())
        ->whereNull('catalogue_item_variant_id')
        ->sole();

    expect($deskOffer->is_available)->toBeTrue();
});

it('refuses, on a published listing, a ticked place left with no priced pack — and allows unticking every place', function (): void {
    $this->meal->status = CatalogueItemStatus::Published;
    $this->meal->save();

    $fields = ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)(null, $this->bottle, [], 600, null)]], 0)
        ->assertStatus(422)
        ->json('error.details.fields');

    // Home is priced and the counter charges it; Business is ticked with nothing to sell.
    expect(array_keys($fields))->toBe(['places.business']);

    ($this->put)(['places' => ($this->places)(false, false, false), 'packs' => []], 0)->assertOk();
});

it('refuses a stale lock', function (): void {
    ($this->put)(['places' => ($this->places)(), 'packs' => [($this->pack)(null, $this->bottle, [], 600, null)]], 7)->assertStatus(409);

    expect(PriceListItem::withoutTenancy()->count())->toBe(0);
});

it('answers the selling check from what it stored, inherited prices included', function (): void {
    $reasons = fn (): array => array_map(
        static fn (array $reason): string => $reason['code'].(isset($reason['context']['place']) ? ':'.$reason['context']['place'] : ''),
        app(SellingReadiness::class)->reasons($this->meal->fresh()),
    );

    expect($reasons())->toBe(['no_pack', 'no_selling_place']);

    ($this->put)(['places' => ($this->places)(true, true, true), 'packs' => [($this->pack)(null, $this->bottle, [], 600, null)]], 0)->assertOk();

    expect($reasons())->toBe(['place_unpriced:business']);

    // A pack-less Business price written after the save is inherited, and counts.
    PricingWorld::price($this->tradeList, $this->meal, null, 500);

    expect($reasons())->toBe([]);
});
