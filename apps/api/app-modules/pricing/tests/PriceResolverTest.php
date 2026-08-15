<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Services\ResolvedPrice;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| What one article actually costs, through one channel, on one day
|--------------------------------------------------------------------------
|
| The question every downstream surface asks — a listing, a cart, an order
| snapshot in C1 — answered in one place so that four surfaces cannot answer it
| four ways. Which makes this the suite that has to be exhaustive: the walk
| (priority), the tier rule, the variant rule, the date boundaries at both
| ends, and the honest `null`.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = PricingWorld::kitchen('resolver@kitchen.test');
    $this->channel = PricingWorld::channel($this->a->organisation);
    $this->product = PricingWorld::product($this->a);
    $this->resolver = app(PriceResolver::class);

    $this->resolve = fn (mixed ...$args): ?ResolvedPrice => $this->resolver->currentFor(
        (string) $this->channel->getKey(),
        (string) $this->product->item->getKey(),
        ...$args,
    );
});

it('answers with the amount, its currency and the row that said so', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    PricingWorld::assign($this->channel, $list);
    $row = PricingWorld::price($list, $this->product->item, null, 2200);

    $price = ($this->resolve)();

    expect($price)->toBeInstanceOf(ResolvedPrice::class)
        ->and($price->amountMinor)->toBe(2200)
        // The currency comes from the list, always — an amount without one is
        // meaningless, and C1's order snapshot needs the row it came from so
        // the charge stays explainable after the row is closed.
        ->and($price->currencyCode)->toBe($this->a->organisation->default_currency_code)
        ->and($price->priceListId)->toBe((string) $list->getKey())
        ->and($price->priceListItemId)->toBe((string) $row->getKey());
});

it('answers null when no channel assignment exists at all', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    PricingWorld::price($list, $this->product->item, null, 2200);

    expect(($this->resolve)())->toBeNull();
});

it('never prices from a draft list', function (): void {
    // That is what draft means. A tariff nobody has activated must not reach a
    // customer through a channel assignment somebody made early.
    $draft = PricingWorld::priceList($this->a->organisation, 'draft-usd');

    PricingWorld::assign($this->channel, $draft);
    PricingWorld::price($draft, $this->product->item, null, 2200);

    expect(($this->resolve)())->toBeNull();
});

it('never prices from an archived list', function (): void {
    $archived = PricingWorld::priceList($this->a->organisation, 'old-usd');
    $archived->status = PriceListStatus::Archived;
    $archived->save();

    PricingWorld::assign($this->channel, $archived);
    PricingWorld::price($archived, $this->product->item, null, 2200);

    expect(($this->resolve)())->toBeNull();
});

it('consults the lists in priority order and stops at the first that prices the point', function (): void {
    // The negotiated sheet overrides the standing tariff. Lists are not
    // merged: the first that answers wins outright.
    $agreement = PricingWorld::priceList($this->a->organisation, 'acme-usd', active: true);
    $standard = PricingWorld::priceList($this->a->organisation, 'trade-usd', active: true);

    PricingWorld::assign($this->channel, $agreement, priority: 0);
    PricingWorld::assign($this->channel, $standard, priority: 1);

    PricingWorld::price($agreement, $this->product->item, null, 1800);
    PricingWorld::price($standard, $this->product->item, null, 2200);

    expect(($this->resolve)()->amountMinor)->toBe(1800)
        ->and(($this->resolve)()->priceListId)->toBe((string) $agreement->getKey());
});

it('falls through to the next list when the first prices nothing for the point', function (): void {
    // A gap in the agreement is a gap, not a hole. This is what lets a
    // client's deal override two lines without restating the other four
    // hundred.
    $agreement = PricingWorld::priceList($this->a->organisation, 'acme-usd', active: true);
    $standard = PricingWorld::priceList($this->a->organisation, 'trade-usd', active: true);
    $other = PricingWorld::product($this->a, 'Zaatar blend', 'pouch-100g');

    PricingWorld::assign($this->channel, $agreement, priority: 0);
    PricingWorld::assign($this->channel, $standard, priority: 1);

    // The agreement prices a different article entirely.
    PricingWorld::price($agreement, $other->item, null, 900);
    PricingWorld::price($standard, $this->product->item, null, 2200);

    expect(($this->resolve)()->amountMinor)->toBe(2200)
        ->and(($this->resolve)()->priceListId)->toBe((string) $standard->getKey());
});

it('falls through when the leading list prices the point only as a placeholder', function (): void {
    // A placeholder is not a price, so it does not stop the walk. The
    // alternative — treating it as an answer — would make an unpriced row on a
    // negotiated sheet silently suppress the standing tariff behind it.
    $agreement = PricingWorld::priceList($this->a->organisation, 'acme-usd', active: true);
    $standard = PricingWorld::priceList($this->a->organisation, 'trade-usd', active: true);

    PricingWorld::assign($this->channel, $agreement, priority: 0);
    PricingWorld::assign($this->channel, $standard, priority: 1);

    PricingWorld::price($agreement, $this->product->item, null, null, null, PriceStatus::Placeholder);
    PricingWorld::price($standard, $this->product->item, null, 2200);

    expect(($this->resolve)()->amountMinor)->toBe(2200);
});

it('answers null when the only rows are placeholders or market-priced', function (): void {
    // **Honest absence.** A resolver that returned a populated object with a
    // null amount would push every caller into a null check they did not know
    // they needed, and the first one that forgot would render `0`.
    $list = PricingWorld::priceList($this->a->organisation, active: true);
    $other = PricingWorld::product($this->a, 'Zaatar blend', 'pouch-100g');

    PricingWorld::assign($this->channel, $list);
    PricingWorld::price($list, $this->product->item, null, null, null, PriceStatus::Placeholder);
    PricingWorld::price($list, $other->item, null, null, null, PriceStatus::MarketPriced);

    expect(($this->resolve)())->toBeNull()
        ->and($this->resolver->currentFor(
            (string) $this->channel->getKey(),
            (string) $other->item->getKey(),
        ))->toBeNull();
});

it('picks the highest tier at or below the quantity asked for', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    PricingWorld::assign($this->channel, $list);
    PricingWorld::price($list, $this->product->item, null, 2200);
    PricingWorld::price($list, $this->product->item, null, 1900, minQuantity: 10.0);
    PricingWorld::price($list, $this->product->item, null, 1600, minQuantity: 50.0);

    // A tier says "from here upwards".
    expect(($this->resolve)(null, 1)->amountMinor)->toBe(2200)
        ->and(($this->resolve)(null, 9)->amountMinor)->toBe(2200)
        ->and(($this->resolve)(null, 10)->amountMinor)->toBe(1900)
        ->and(($this->resolve)(null, 49)->amountMinor)->toBe(1900)
        ->and(($this->resolve)(null, 50)->amountMinor)->toBe(1600)
        ->and(($this->resolve)(null, 5000)->amountMinor)->toBe(1600)
        // No quantity means one.
        ->and(($this->resolve)()->amountMinor)->toBe(2200);
});

it('answers null when every tier starts above the quantity asked for', function (): void {
    // No base row, and the smallest tier is a dozen. One jar has no price, and
    // saying so is better than quietly quoting the bulk rate.
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    PricingWorld::assign($this->channel, $list);
    PricingWorld::price($list, $this->product->item, null, 1900, minQuantity: 12.0);

    expect(($this->resolve)(null, 1))->toBeNull()
        ->and(($this->resolve)(null, 12)->amountMinor)->toBe(1900);
});

it('reports the tier the price came from', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    PricingWorld::assign($this->channel, $list);
    PricingWorld::price($list, $this->product->item, null, 2200);
    PricingWorld::price($list, $this->product->item, null, 1900, minQuantity: 10.0);

    expect(($this->resolve)(null, 1)->minQuantity)->toBeNull()
        ->and((float) ($this->resolve)(null, 20)->minQuantity)->toBe(10.0);
});

it('prefers a variants own price and falls back to the item level', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    PricingWorld::assign($this->channel, $list);
    PricingWorld::price($list, $this->product->item, null, 2000);
    PricingWorld::price($list, $this->product->item, $this->product->variant, 2200);

    // The named variant's own row wins.
    expect(($this->resolve)((string) $this->product->variant->getKey())->amountMinor)->toBe(2200);

    // A second variant with no row of its own falls back to the article price,
    // because a kitchen that prices the article once means it for every pack.
    $second = CatalogueItemVariant::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'catalogue_item_id' => $this->product->item->getKey(),
        'variant_type' => 'pack',
        'code' => 'jar-1kg',
        'status' => 'active',
        'lock_version' => 0,
    ]);

    expect(($this->resolve)((string) $second->getKey())->amountMinor)->toBe(2000);
});

it('never answers an article-level question with one packs price', function (): void {
    // Asking "what does the harissa cost" must not be answered with the 250 g
    // jar's number — that is wrong by a factor of four, and wrong silently.
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    PricingWorld::assign($this->channel, $list);
    PricingWorld::price($list, $this->product->item, $this->product->variant, 2200);

    expect(($this->resolve)())->toBeNull();
});

it('considers every tier of the fallback, not merely the ones the variant missed', function (): void {
    // The fallback is a whole second pass. A variant with one row at a high
    // tier must not shadow the article's own base price at quantity one.
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    PricingWorld::assign($this->channel, $list);
    PricingWorld::price($list, $this->product->item, null, 2000);
    PricingWorld::price($list, $this->product->item, $this->product->variant, 1500, minQuantity: 100.0);

    expect(($this->resolve)((string) $this->product->variant->getKey(), 1)->amountMinor)->toBe(2000)
        ->and(($this->resolve)((string) $this->product->variant->getKey(), 100)->amountMinor)->toBe(1500);
});

it('honours the effective interval at both ends, with an exclusive close', function (): void {
    $list = PricingWorld::priceList($this->a->organisation, active: true);

    PricingWorld::assign($this->channel, $list);

    $march = CarbonImmutable::parse('2026-03-01');
    $april = CarbonImmutable::parse('2026-04-01');

    PricingWorld::price($list, $this->product->item, null, 2000, from: $march, to: $april);
    PricingWorld::price($list, $this->product->item, null, 2400, from: $april);

    // Before the first row opened: nothing.
    expect(($this->resolve)(null, null, $march->subDay()))->toBeNull()
        // The day it opened is inside the interval.
        ->and(($this->resolve)(null, null, $march)->amountMinor)->toBe(2000)
        ->and(($this->resolve)(null, null, $april->subDay())->amountMinor)->toBe(2000)
        // And the day it closed belongs to its successor, not to both. This is
        // the whole reason `effective_to` is exclusive.
        ->and(($this->resolve)(null, null, $april)->amountMinor)->toBe(2400)
        ->and(($this->resolve)(null, null, $april->addYear())->amountMinor)->toBe(2400);
});

it('honours the lists own validity window, inclusive at both ends', function (): void {
    // The other convention, and deliberately the other way round: a human
    // writing "valid to 30 June" means through the 30th.
    $list = PricingWorld::priceList($this->a->organisation, active: true);
    $list->valid_from = CarbonImmutable::parse('2026-06-01');
    $list->valid_to = CarbonImmutable::parse('2026-06-30');
    $list->save();

    PricingWorld::assign($this->channel, $list);
    PricingWorld::price($list, $this->product->item, null, 2200, from: CarbonImmutable::parse('2026-01-01'));

    expect(($this->resolve)(null, null, CarbonImmutable::parse('2026-05-31')))->toBeNull()
        ->and(($this->resolve)(null, null, CarbonImmutable::parse('2026-06-01'))->amountMinor)->toBe(2200)
        ->and(($this->resolve)(null, null, CarbonImmutable::parse('2026-06-30'))->amountMinor)->toBe(2200)
        ->and(($this->resolve)(null, null, CarbonImmutable::parse('2026-07-01')))->toBeNull();
});

it('skips a list whose window has closed and answers from the one behind it', function (): void {
    $expired = PricingWorld::priceList($this->a->organisation, 'summer-usd', active: true);
    $expired->valid_to = CarbonImmutable::parse('2026-06-30');
    $expired->save();

    $standing = PricingWorld::priceList($this->a->organisation, 'trade-usd', active: true);

    PricingWorld::assign($this->channel, $expired, priority: 0);
    PricingWorld::assign($this->channel, $standing, priority: 1);

    PricingWorld::price($expired, $this->product->item, null, 1800, from: CarbonImmutable::parse('2026-01-01'));
    PricingWorld::price($standing, $this->product->item, null, 2200, from: CarbonImmutable::parse('2026-01-01'));

    expect(($this->resolve)(null, null, CarbonImmutable::parse('2026-06-15'))->amountMinor)->toBe(1800)
        ->and(($this->resolve)(null, null, CarbonImmutable::parse('2026-07-15'))->amountMinor)->toBe(2200);
});

it('refuses to price through a list that belongs to another organisation', function (): void {
    // Defence in depth. The assignment endpoint cannot create this — both the
    // channel and the list are resolved through the tenant scope — so the row
    // below is planted directly. The resolver derives its scope from the
    // channel's own organisation rather than from ambient context, so a
    // foreign list cannot price through a local channel even if one ever got
    // in by another route.
    $b = PricingWorld::kitchen('foreign-list@kitchen.test');
    $theirList = PricingWorld::priceList($b->organisation, 'their-usd', active: true);

    PricingWorld::price($theirList, PricingWorld::product($b)->item, null, 111);

    ChannelPriceList::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'sales_channel_id' => $this->channel->getKey(),
        'price_list_id' => $theirList->getKey(),
        'priority' => 0,
    ]);

    expect(($this->resolve)())->toBeNull();
});

it('never resolves through another kitchens channel', function (): void {
    $b = PricingWorld::kitchen('other-resolver@kitchen.test');
    $theirChannel = PricingWorld::channel($b->organisation, 'their-web');
    $theirList = PricingWorld::priceList($b->organisation, 'their-usd', active: true);

    PricingWorld::assign($theirChannel, $theirList);
    PricingWorld::price($theirList, PricingWorld::product($b)->item, null, 999);

    // Our article, their channel: nothing. The resolver is not a cross-tenant
    // lookup and must not become one by accident.
    expect(($this->resolver)->currentFor(
        (string) $theirChannel->getKey(),
        (string) $this->product->item->getKey(),
    ))->toBeNull();
});
