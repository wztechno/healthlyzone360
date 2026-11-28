<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\DishMargin;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/*
| The one question the Packs & prices tab has to answer the same way everywhere:
| what can be bought, and for how much.
|
| It starts where real items start — a price with no pack, and two packs that
| both inherit it (`PriceResolver::pickRow` falls back to the item's pack-less
| row). One pack's price is then cleared through the packs endpoint. The editor's
| read, the publication check, Dish margins and the checkout probe must all agree
| that one size is on sale and the other is not.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = PricingWorld::kitchen('packs-acceptance@kitchen.test');
    $this->headers = PricingWorld::headers($this->a);
    $this->currency = (string) $this->a->organisation->default_currency_code;
    $this->meal = PricingWorld::meal($this->a, 'Garlic mayo');

    $this->shop = PricingWorld::channel($this->a->organisation, 'web-shop');
    $this->shop->channel_kind = SalesChannelKind::B2cWeb;
    $this->shop->save();

    $this->wholesale = PricingWorld::channel($this->a->organisation, 'wholesale');
    $this->wholesale->channel_kind = SalesChannelKind::B2b;
    $this->wholesale->save();

    $this->desk = PricingWorld::channel($this->a->organisation, 'desk');
    $this->desk->channel_kind = SalesChannelKind::Pos;
    $this->desk->save();

    $this->retailList = PricingWorld::priceList($this->a->organisation, 'retail-usd', active: true);
    $this->tradeList = PricingWorld::priceList($this->a->organisation, 'trade-usd', active: true);
    PricingWorld::assign($this->shop, $this->retailList);
    // The counter quotes from the web shop's list, as migration 003005 leaves every kitchen.
    PricingWorld::assign($this->desk, $this->retailList);
    PricingWorld::assign($this->wholesale, $this->tradeList);

    $this->actingAs($this->a->user);

    $item = '/api/v1/catalogue/items/'.$this->meal->getKey();
    $this->url = $item.'/packs';

    // Two packs with no price of their own…
    $kg = (string) MeasurementUnit::query()->where('code', 'kg')->value('id');
    $this->putJson($item.'/variants', ['variants' => [
        ['code' => 'half', 'name_en' => 'Bottle 0.5 L', 'pack' => ['pack_quantity' => 0.5, 'pack_unit_id' => $kg]],
        ['code' => 'one', 'name_en' => 'Bottle 1 L', 'pack' => ['pack_quantity' => 1, 'pack_unit_id' => $kg]],
    ]], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $packs = CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->get()->keyBy('code');
    $this->half = $packs['half'];
    $this->one = $packs['one'];

    // …and the item's pack-less Home shop price, which both of them inherit.
    PricingWorld::price($this->retailList, $this->meal, null, 1000);

    // On sale, so the checkout probe quotes it (a draft is refused `item_not_published`,
    // and a refused probe carries no price) and the published-listing rule applies.
    $this->meal->status = CatalogueItemStatus::Published;
    $this->meal->save();

    $this->statement = fn (?int $half, ?int $one, array $places): array => [
        'places' => $places + ['home' => false, 'business' => false, 'counter' => false],
        'packs' => [
            ['id' => (string) $this->half->getKey(), 'fill' => ['quantity' => 0.5, 'unit' => 'kg'], 'components' => [], 'prices' => ['home' => $half, 'business' => null]],
            ['id' => (string) $this->one->getKey(), 'fill' => ['quantity' => 1, 'unit' => 'kg'], 'components' => [], 'prices' => ['home' => $one, 'business' => null]],
        ],
    ];

    $this->quote = fn ($channel, CatalogueItemVariant $pack) => app(LineProbe::class)->probe(
        $channel,
        (string) $this->meal->getKey(),
        (string) $pack->getKey(),
        '1',
        null,
        $this->currency,
        enforceCalendar: false,
        enforceAssessment: false,
    );

    $this->refusalsOf = fn ($result): array => array_column($result->refusals, 'reason');
});

it('reads both packs at the inherited price before anything is written', function (): void {
    $this->getJson($this->url, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.places.counter.follows_home', true)
        ->assertJsonPath('data.packs.0.prices.home', ['amount_minor' => 1000, 'inherited' => true])
        ->assertJsonPath('data.packs.1.prices.home', ['amount_minor' => 1000, 'inherited' => true])
        ->assertJsonPath('data.packs.0.prices.business', null);
});

it('takes a pack off sale when its price is cleared, and the editor and the checkout agree', function (): void {
    $this->putJson($this->url, ($this->statement)(1200, null, ['home' => true, 'counter' => true]), $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.packs.0.prices.home', ['amount_minor' => 1200, 'inherited' => false])
        ->assertJsonPath('data.packs.1.prices.home', null);

    // The pack-less row is closed, so nothing is left for the cleared pack to fall back to.
    expect(PriceListItem::withoutTenancy()
        ->where('price_list_id', $this->retailList->getKey())
        ->whereNull('catalogue_item_variant_id')
        ->whereNull('effective_to')
        ->count())->toBe(0);

    foreach ([$this->shop, $this->desk] as $channel) {
        $priced = ($this->quote)($channel, $this->half);
        $cleared = ($this->quote)($channel, $this->one);

        // The counter charges the Home shop price.
        expect($priced->price?->amountMinor)->toBe(1200)
            ->and(($this->refusalsOf)($priced))->not->toContain('unpriced', 'channel_unavailable')
            ->and(($this->refusalsOf)($cleared))->toContain('unpriced');
    }
});

it('sells at the counter only when the web shop is switched off', function (): void {
    $this->putJson($this->url, ($this->statement)(1200, null, ['counter' => true]), $this->headers + ['If-Match' => '"1"'])->assertOk();

    expect(($this->refusalsOf)(($this->quote)($this->shop, $this->half)))->toContain('channel_unavailable')
        ->and(($this->quote)($this->desk, $this->half)->price?->amountMinor)->toBe(1200)
        ->and(($this->refusalsOf)(($this->quote)($this->desk, $this->half)))->not->toContain('unpriced', 'channel_unavailable');
});

it('refuses the counter when the desk quotes from another list', function (): void {
    $counterList = PricingWorld::priceList($this->a->organisation, 'counter-usd', active: true);
    PricingWorld::assign($this->desk, $counterList, priority: -1);

    $this->getJson($this->url, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.places.counter.follows_home', false);

    $this->putJson($this->url, ($this->statement)(1200, null, ['home' => true, 'counter' => true]), $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(422);
});

// Slice C: the publication check gives the same answer as the read above —
// no `no_pack`, `no_selling_place` or `place_unpriced` once one pack is priced
// for every ticked place, and `place_unpriced` once the last one is cleared.
it('reports the same sellable state from the publication check', function (): void {
    $readiness = '/api/v1/catalogue/items/'.$this->meal->getKey().'/readiness';
    $sellingCodes = ['no_pack', 'no_selling_place', 'place_unpriced'];
    $selling = fn (): array => collect($this->getJson($readiness, $this->headers)->assertOk()->json('data.reasons'))
        ->filter(static fn (array $reason): bool => in_array($reason['code'], $sellingCodes, true))
        ->map(static fn (array $reason): string => $reason['code'].(isset($reason['context']['place']) ? ':'.$reason['context']['place'] : ''))
        ->values()
        ->all();

    $this->putJson($this->url, ($this->statement)(1200, null, ['home' => true, 'counter' => true]), $this->headers + ['If-Match' => '"1"'])
        ->assertOk();

    expect($selling())->toBe([]);

    // The published-listing rule refuses a write that leaves a ticked place
    // unpriced, so the cleared state is reached on a draft.
    $this->meal->status = CatalogueItemStatus::Draft;
    $this->meal->save();

    $lock = $this->meal->refresh()->lock_version;

    $this->putJson($this->url, ($this->statement)(null, null, ['home' => true, 'counter' => true]), $this->headers + ['If-Match' => '"'.$lock.'"'])
        ->assertOk();

    // The counter charges the Home shop price, so it goes unpriced with it.
    expect($selling())->toBe(['place_unpriced:home', 'place_unpriced:counter']);
});

// Dish margins is refreshed by the write itself — no nightly run in between — and
// never states the cleared pack. This meal has no recipe, so the page carries its
// one pack-less row saying so; the margin figures themselves, with a recipe behind
// them, are `DishMarginsTest`'s freshness case.
it('refreshes Dish margins with the write, and never lists the cleared pack', function (): void {
    expect(DishMargin::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->count())->toBe(0);

    $this->putJson($this->url, ($this->statement)(1200, null, ['home' => true, 'counter' => true]), $this->headers + ['If-Match' => '"1"'])
        ->assertOk();

    $rows = DishMargin::withoutTenancy()->where('catalogue_item_id', $this->meal->getKey())->get();

    expect($rows)->not->toBeEmpty()
        ->and($rows->where('catalogue_item_variant_id', (string) $this->one->getKey()))->toHaveCount(0)
        ->and($rows->whereNotNull('margin_percent'))->toHaveCount(0);
});
