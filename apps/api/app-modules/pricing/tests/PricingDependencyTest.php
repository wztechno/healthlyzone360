<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Tenancy\Exceptions\MissingTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| What a price holds on to, and what holds on to a price
|--------------------------------------------------------------------------
|
| A price row is the record of what a customer was charged, so the article it
| points at cannot be deleted out from under it. That is `restrictOnDelete` on
| both the item and the variant, and it is the deliberate exception to the
| catalogue's usual cascade — the catalogue's own answer to withdrawal is
| `retire`, which leaves every row standing.
|
| The other half is the tenant boundary at the application layer.
| `RlsTest` proves the PostgreSQL policy independently, under SET ROLE; this
| suite proves the global scope, which is the layer a query actually passes
| through first (ADR-0007: two layers, two suites).
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = PricingWorld::kitchen('deps@kitchen.test');
    $this->list = PricingWorld::priceList($this->a->organisation, 'web-usd');
    $this->product = PricingWorld::product($this->a);
});

it('refuses to delete a catalogue item that has ever been priced', function (): void {
    PricingWorld::price($this->list, $this->product->item, null, 2200);

    // A savepoint, so the refusal does not abort the transaction the test
    // itself is running inside.
    $delete = fn () => DB::transaction(fn () => CatalogueItem::withoutTenancy()->whereKey($this->product->item->getKey())->delete());

    expect($delete)->toThrow(QueryException::class);

    expect(CatalogueItem::withoutTenancy()->whereKey($this->product->item->getKey())->exists())->toBeTrue();
});

it('refuses to delete a variant that has ever been priced', function (): void {
    PricingWorld::price($this->list, $this->product->item, $this->product->variant, 2200);

    $delete = fn () => DB::transaction(fn () => CatalogueItemVariant::withoutTenancy()->whereKey($this->product->variant->getKey())->delete());

    expect($delete)->toThrow(QueryException::class);
});

it('still refuses when only closed history points at the article', function (): void {
    // The important half. A price that was withdrawn last spring is still the
    // record of what somebody paid, and the restriction has to survive the
    // withdrawal or the evidence disappears with the article.
    PricingWorld::price(
        $this->list, $this->product->item, null, 2200,
        from: now()->subMonths(2)->startOfDay()->toImmutable(),
        to: now()->subMonth()->startOfDay()->toImmutable(),
    );

    // A savepoint, so the refusal does not abort the transaction the test
    // itself is running inside.
    $delete = fn () => DB::transaction(fn () => CatalogueItem::withoutTenancy()->whereKey($this->product->item->getKey())->delete());

    expect($delete)->toThrow(QueryException::class);
});

it('takes the whole tariff with the price list when the list itself goes', function (): void {
    // Entries and assignments cascade *from the list*, which is the one
    // deletion that is coherent: a list that no longer exists cannot have
    // priced anything. Nothing in the API deletes a list — `archive` is the
    // withdrawal — so this is the schema being consistent rather than a
    // supported operation.
    $channel = PricingWorld::channel($this->a->organisation);

    PricingWorld::price($this->list, $this->product->item, null, 2200);
    PricingWorld::assign($channel, $this->list);

    PriceList::withoutTenancy()->whereKey($this->list->getKey())->delete();

    expect(PriceListItem::withoutTenancy()->where('price_list_id', $this->list->getKey())->count())->toBe(0)
        ->and(ChannelPriceList::withoutTenancy()->where('price_list_id', $this->list->getKey())->count())->toBe(0);
});

it('detaches a channel assignment when the channel goes, and leaves the tariff standing', function (): void {
    $channel = PricingWorld::channel($this->a->organisation);

    PricingWorld::price($this->list, $this->product->item, null, 2200);
    PricingWorld::assign($channel, $this->list);

    $channel->delete();

    expect(ChannelPriceList::withoutTenancy()->where('price_list_id', $this->list->getKey())->count())->toBe(0)
        ->and(PriceListItem::withoutTenancy()->where('price_list_id', $this->list->getKey())->count())->toBe(1)
        ->and(PriceList::withoutTenancy()->whereKey($this->list->getKey())->exists())->toBeTrue();
});

it('scopes every pricing query to the active organisation', function (): void {
    $b = PricingWorld::kitchen('other-deps@kitchen.test');
    $theirList = PricingWorld::priceList($b->organisation, 'their-usd');
    $theirProduct = PricingWorld::product($b);
    $theirChannel = PricingWorld::channel($b->organisation, 'their-web');

    $mine = PricingWorld::price($this->list, $this->product->item, null, 2200);
    $theirs = PricingWorld::price($theirList, $theirProduct->item, null, 999);

    PricingWorld::assign($theirChannel, $theirList);

    app(TenantContext::class)->setOrganisation(
        (string) $this->a->user->getKey(),
        (string) $this->a->organisation->getKey(),
    );

    expect(PriceList::query()->pluck('code')->all())->toBe(['web-usd'])
        ->and(PriceListItem::query()->pluck('id')->all())->toBe([$mine->getKey()])
        ->and(PriceListItem::query()->pluck('id')->all())->not->toContain($theirs->getKey())
        ->and(ChannelPriceList::query()->count())->toBe(0);
});

it('classifies the amount as confidential and the list header as internal', function (): void {
    // The classification is what the data register and the RLS decision both
    // rest on, so it is asserted rather than left as a docblock. The split is
    // the point: a tariff's *name* is internal, its *numbers* are not.
    expect(Classified::map(PriceListItem::class))->toMatchArray([
        'unit_amount_minor' => DataClassification::Confidential,
        'min_quantity' => DataClassification::Confidential,
    ]);

    expect(Classified::map(PriceList::class))->toMatchArray([
        'code' => DataClassification::Internal,
        'name_en' => DataClassification::Internal,
    ]);
});

it('keeps a pricing model unreadable with no tenant context at all', function (): void {
    // Fail-closed: the global scope throws rather than quietly returning
    // everything, which is the difference between a bug and a breach.
    PricingWorld::price($this->list, $this->product->item, null, 2200);

    app(TenantContext::class)->clear();

    expect(fn () => PriceListItem::query()->get())
        ->toThrow(MissingTenantContext::class);
});
