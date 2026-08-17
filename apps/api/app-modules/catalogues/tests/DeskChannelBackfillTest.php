<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\Migrations\Migration;

/*
|--------------------------------------------------------------------------
| Opening a counter for kitchens that were provisioned before there was one
|--------------------------------------------------------------------------
|
| Two migrations, and neither is optional. A `desk` sales channel on its own
| sells nothing at all, silently: `LineProbe` refuses every article that has no
| `channel_catalogue_items` row for the channel (`channel_unavailable`), and
| `PriceResolver::listsFor()` reads `channel_price_lists` as the only source of
| a channel's tariffs, so an empty set makes every line refuse `unpriced`. The
| suite therefore asserts the *outcome a counter sale needs* — the same article,
| offered on the same terms, at the same price — rather than three row counts
| that would all pass against a desk nobody could buy from.
|
| ## Why the migrations are called rather than relied upon
|
| `RefreshDatabase` migrates **before** any fixture exists, so the backfill has
| already run against an empty database by the time a test says `it(`. Asserting
| on what it did then would be asserting that nothing happened to nothing. So
| each test builds the world the backfill is *for* — kitchens with web shops,
| assignments, tariffs — and then runs the two migrations' `up()` directly. That
| is also what makes the idempotency assertion honest: the second run is a real
| second run, against a database the first one has already changed.
|
| There is no other data migration in this repository with a test, so there was
| no house pattern to follow; this is the one.
|
| ## Why a catalogues suite reaches into Pricing and Cart
|
| The migration under test lives in this module, and the outcome it has to prove
| does not: half of what makes a desk sellable is a `channel_price_lists` row,
| and the only honest way to ask "does the counter quote the same price" is to
| ask `LineProbe`, which is the one place that question is answered. A parity
| test that stopped at this module's own table would pass against a desk that
| refuses every line as `unpriced`. Module direction is a rule about source, not
| about the suite that proves two modules agree.
|
| ## The fixture is chosen to catch the copies that go wrong quietly
|
| A plain item-level assignment would pass under almost any implementation, so
| there is one of those and then three that would not. A **variant-scoped** row,
| which is what makes the plain one dangerous: the unique key is `NULLS NOT
| DISTINCT`, so a guard written with `=` instead of `IS NOT DISTINCT FROM`
| duplicates every item-level row on the second run and the constraint, not the
| test, is what fails. A **windowed** row, because a copy that dropped the dates
| would put a seasonal dish on the counter all year. And a **switched-off** row,
| because `is_available = false` copied as `true` would put a withdrawn dish back
| on sale — the worst of the three, since it looks like the feature working.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('desk-backfill@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->userId = (string) $this->tenant->user->getKey();
    $this->shop = PricingWorld::channel($this->organisation, 'web-shop');

    $this->today = CarbonImmutable::now()->startOfDay();
});

/**
 * Run the two backfills, in the order their filenames put them in.
 *
 * `require` rather than `require_once`, exactly as `Migrator::resolvePath()`
 * does it: these files return an anonymous class instance, and a test that runs
 * them twice is testing the thing worth testing.
 */
function runTheDeskBackfill(): void
{
    $paths = [
        'catalogues/database/migrations/2026_08_15_003004_open_a_desk_channel_for_every_kitchen.php',
        'pricing/database/migrations/2026_08_15_003005_price_the_desk_channel_from_the_web_shop_tariffs.php',
    ];

    foreach ($paths as $path) {
        $migration = require base_path('app-modules/'.$path);

        if (! $migration instanceof Migration) {
            throw new RuntimeException("{$path} did not return a migration.");
        }

        $migration->up();
    }
}

/**
 * A published article the channel machinery will actually price.
 *
 * Published, because `LineProbe` refuses anything else and a fixture full of
 * drafts would make every parity assertion pass by refusing both channels
 * identically.
 */
function deskMeal(object $tenant, string $nameEn): CatalogueItem
{
    $meal = PricingWorld::meal($tenant, $nameEn);
    $meal->forceFill(['status' => CatalogueItemStatus::Published])->save();

    return $meal;
}

/**
 * One statement about what a channel offers, written straight to the table —
 * the shape `ChannelAvailabilityService` produces, without the lock-version
 * ceremony a backfill has nothing to do with.
 */
function deskOffering(
    object $test,
    SalesChannel $channel,
    CatalogueItem $item,
    ?CatalogueItemVariant $variant = null,
    bool $isAvailable = true,
    ?string $from = null,
    ?string $to = null,
): ChannelCatalogueItem {
    return ChannelCatalogueItem::withoutTenancy()->create([
        'organisation_id' => (string) $channel->organisation_id,
        'sales_channel_id' => (string) $channel->getKey(),
        'catalogue_item_id' => (string) $item->getKey(),
        'catalogue_item_variant_id' => $variant?->getKey(),
        'is_available' => $isAvailable,
        'available_from' => $from,
        'available_to' => $to,
        'created_by' => $test->userId,
    ]);
}

/**
 * Everything one channel offers, as comparable strings — every column the
 * backfill claims to copy, so a parity assertion cannot pass on the identifiers
 * alone.
 *
 * @return list<string>
 */
function deskOfferings(SalesChannel $channel): array
{
    return ChannelCatalogueItem::withoutTenancy()
        ->where('sales_channel_id', $channel->getKey())
        ->get()
        ->map(static fn (ChannelCatalogueItem $row): string => implode('|', [
            (string) $row->organisation_id,
            (string) $row->catalogue_item_id,
            (string) $row->catalogue_item_variant_id,
            $row->is_available ? 'on' : 'off',
            (string) $row->available_from?->toDateString(),
            (string) $row->available_to?->toDateString(),
        ]))
        ->sort()
        ->values()
        ->all();
}

/**
 * @return list<string>
 */
function deskTariffs(SalesChannel $channel): array
{
    return ChannelPriceList::withoutTenancy()
        ->where('sales_channel_id', $channel->getKey())
        ->get()
        ->map(static fn (ChannelPriceList $row): string => implode('|', [
            (string) $row->organisation_id,
            (string) $row->price_list_id,
            (string) $row->priority,
        ]))
        ->sort()
        ->values()
        ->all();
}

function theDeskOf(Organisation $organisation): ?SalesChannel
{
    return SalesChannel::withoutTenancy()
        ->where('organisation_id', $organisation->getKey())
        ->where('code', 'desk')
        ->first();
}

it('opens one desk for each kitchen that has a web shop, and none for a kitchen that has not', function (): void {
    $neighbour = PricingWorld::kitchen('desk-neighbour@kitchen.test');
    PricingWorld::channel($neighbour->organisation, 'web-shop');

    // A kitchen that trades with companies and nobody else. It has a channel,
    // it is a perfectly ordinary organisation, and it is not what this backfill
    // is for: the desk mirrors a *web shop*, and there is nothing to mirror.
    $wholesaleOnly = PricingWorld::kitchen('desk-wholesale-only@kitchen.test');
    SalesChannel::factory()->wholesale()->create([
        'organisation_id' => $wholesaleOnly->organisation->getKey(),
        'code' => 'wholesale',
    ]);

    runTheDeskBackfill();

    $desk = theDeskOf($this->organisation);

    expect($desk)->toBeInstanceOf(SalesChannel::class)
        ->and($desk->channel_kind)->toBe(SalesChannelKind::Pos)
        ->and($desk->status)->toBe(SalesChannelStatus::Active)
        ->and($desk->order_source)->toBe('desk')
        // Nobody clicked anything, and the column is nullable so that a row the
        // platform wrote does not have to name somebody who did not write it.
        ->and($desk->created_by)->toBeNull()
        ->and($desk->updated_by)->toBeNull()
        // Derived from the web shop's own name, with its storefront descriptor
        // stripped: the fixture channel is called plainly "Web shop", so the
        // desk is called plainly "Order desk".
        ->and($desk->name_en)->toBe('Order desk')
        ->and($desk->name_ar)->toBe('مكتب الطلبات');

    expect(theDeskOf($neighbour->organisation))->toBeInstanceOf(SalesChannel::class)
        ->and(theDeskOf($wholesaleOnly->organisation))->toBeNull();
});

it('names the desk after the kitchen when the web shop is named after the kitchen', function (): void {
    $this->shop->forceFill(['name_en' => 'Verdant Kitchen web shop', 'name_ar' => 'مطبخ فيردانت'])->save();

    runTheDeskBackfill();

    $desk = theDeskOf($this->organisation);

    expect($desk->name_en)->toBe('Verdant Kitchen order desk')
        ->and($desk->name_ar)->toBe('مكتب طلبات مطبخ فيردانت');
});

it('mirrors every web shop offering onto the desk, variants and windows and switches included', function (): void {
    $bowl = deskMeal($this->tenant, 'Chicken freekeh bowl');
    $soup = deskMeal($this->tenant, 'Red lentil soup');
    $withdrawn = deskMeal($this->tenant, 'Yesterday special');
    $harissa = PricingWorld::product($this->tenant);
    $harissa->item->forceFill(['status' => CatalogueItemStatus::Published])->save();

    deskOffering($this, $this->shop, $bowl);
    deskOffering($this, $this->shop, $harissa->item, $harissa->variant);
    deskOffering($this, $this->shop, $soup, from: $this->today->subDay()->toDateString(), to: $this->today->addDays(30)->toDateString());
    deskOffering($this, $this->shop, $withdrawn, isAvailable: false);

    runTheDeskBackfill();

    $desk = theDeskOf($this->organisation);

    expect(deskOfferings($desk))->toHaveCount(4)
        ->and(deskOfferings($desk))->toBe(deskOfferings($this->shop));

    // Provenance is the one column that is deliberately *not* copied.
    expect(ChannelCatalogueItem::withoutTenancy()
        ->where('sales_channel_id', $desk->getKey())
        ->whereNotNull('created_by')
        ->count())->toBe(0);

    // And the variant row is a variant row on the desk too, rather than having
    // been flattened into a second item-level statement.
    expect(ChannelCatalogueItem::withoutTenancy()
        ->where('sales_channel_id', $desk->getKey())
        ->where('catalogue_item_variant_id', $harissa->variant->getKey())
        ->count())->toBe(1);
});

it('keeps one kitchens mirror out of another kitchens desk', function (): void {
    $neighbour = PricingWorld::kitchen('desk-isolation@kitchen.test');
    $theirShop = PricingWorld::channel($neighbour->organisation, 'web-shop');
    $theirMeal = deskMeal($neighbour, 'Their dish');

    $ourMeal = deskMeal($this->tenant, 'Our dish');

    deskOffering($this, $this->shop, $ourMeal);
    ChannelCatalogueItem::withoutTenancy()->create([
        'organisation_id' => (string) $neighbour->organisation->getKey(),
        'sales_channel_id' => (string) $theirShop->getKey(),
        'catalogue_item_id' => (string) $theirMeal->getKey(),
        'is_available' => true,
    ]);

    runTheDeskBackfill();

    $ourDesk = theDeskOf($this->organisation);
    $theirDesk = theDeskOf($neighbour->organisation);

    expect(ChannelCatalogueItem::withoutTenancy()->where('sales_channel_id', $ourDesk->getKey())->pluck('catalogue_item_id')->all())
        ->toBe([(string) $ourMeal->getKey()])
        ->and(ChannelCatalogueItem::withoutTenancy()->where('sales_channel_id', $theirDesk->getKey())->pluck('catalogue_item_id')->all())
        ->toBe([(string) $theirMeal->getKey()]);
});

it('gives the desk the web shops tariffs at the priorities the web shop consults them in', function (): void {
    $menu = PricingWorld::priceList($this->organisation, 'menu-usd', active: true);
    $products = PricingWorld::priceList($this->organisation, 'products-usd', active: true);

    PricingWorld::assign($this->shop, $menu, priority: 0);
    PricingWorld::assign($this->shop, $products, priority: 2);

    runTheDeskBackfill();

    $desk = theDeskOf($this->organisation);

    expect(deskTariffs($desk))->toHaveCount(2)
        ->and(deskTariffs($desk))->toBe(deskTariffs($this->shop))
        ->and(ChannelPriceList::withoutTenancy()
            ->where('sales_channel_id', $desk->getKey())
            ->whereNotNull('created_by')
            ->count())->toBe(0);
});

it('prices a line at the desk exactly as the web shop prices it', function (): void {
    // The assertion the whole commit exists for. Both halves of the backfill are
    // in play: without the availability copy this refuses `channel_unavailable`,
    // without the tariff copy it refuses `unpriced`, and both refusals look
    // identical from the counter — a line that will not sell.
    $bowl = deskMeal($this->tenant, 'Chicken freekeh bowl');
    $harissa = PricingWorld::product($this->tenant);
    $harissa->item->forceFill(['status' => CatalogueItemStatus::Published])->save();

    deskOffering($this, $this->shop, $bowl);
    deskOffering($this, $this->shop, $harissa->item, $harissa->variant);

    $menu = PricingWorld::priceList($this->organisation, 'menu-usd', active: true);
    PricingWorld::assign($this->shop, $menu);
    PricingWorld::price($menu, $bowl, null, 4200);
    PricingWorld::price($menu, $harissa->item, $harissa->variant, 2200);

    runTheDeskBackfill();

    $desk = theDeskOf($this->organisation);
    $probe = app(LineProbe::class);
    $currency = (string) $this->organisation->default_currency_code;

    foreach ([[$bowl, null, 4200], [$harissa->item, $harissa->variant, 2200]] as [$item, $variant, $expected]) {
        $onTheShop = $probe->probe($this->shop, (string) $item->getKey(), $variant?->getKey(), '1', $this->today, $currency);
        $atTheDesk = $probe->probe($desk, (string) $item->getKey(), $variant?->getKey(), '1', $this->today, $currency);

        expect($onTheShop->isOrderable())->toBeTrue()
            ->and($atTheDesk->isOrderable())->toBeTrue()
            ->and($atTheDesk->price->amountMinor)->toBe($expected)
            ->and($atTheDesk->price->amountMinor)->toBe($onTheShop->price->amountMinor)
            ->and($atTheDesk->price->currencyCode)->toBe($onTheShop->price->currencyCode)
            // The same row of the same list, not merely the same number: two
            // tariffs agreeing today and diverging next month would pass an
            // amount comparison and fail a customer.
            ->and($atTheDesk->price->priceListId)->toBe($onTheShop->price->priceListId)
            ->and($atTheDesk->price->priceListItemId)->toBe($onTheShop->price->priceListItemId);
    }
});

it('refuses a line at the desk that the web shop has switched off', function (): void {
    // The mirror copies the kitchen's decisions, not merely its catalogue. A
    // withdrawn dish stays withdrawn at the counter on day one.
    $withdrawn = deskMeal($this->tenant, 'Yesterday special');

    deskOffering($this, $this->shop, $withdrawn, isAvailable: false);

    $menu = PricingWorld::priceList($this->organisation, 'menu-usd', active: true);
    PricingWorld::assign($this->shop, $menu);
    PricingWorld::price($menu, $withdrawn, null, 3900);

    runTheDeskBackfill();

    $result = app(LineProbe::class)->probe(
        theDeskOf($this->organisation),
        (string) $withdrawn->getKey(),
        null,
        '1',
        $this->today,
        (string) $this->organisation->default_currency_code,
    );

    expect($result->isOrderable())->toBeFalse()
        ->and(array_column($result->refusals, 'reason'))->toBe(['channel_unavailable']);
});

it('adds nothing on a second run, and restores nothing a kitchen has since changed', function (): void {
    $bowl = deskMeal($this->tenant, 'Chicken freekeh bowl');
    $harissa = PricingWorld::product($this->tenant);
    $harissa->item->forceFill(['status' => CatalogueItemStatus::Published])->save();

    deskOffering($this, $this->shop, $bowl);
    deskOffering($this, $this->shop, $harissa->item, $harissa->variant);
    deskOffering($this, $this->shop, deskMeal($this->tenant, 'Red lentil soup'), from: $this->today->toDateString());

    $menu = PricingWorld::priceList($this->organisation, 'menu-usd', active: true);
    PricingWorld::assign($this->shop, $menu);

    runTheDeskBackfill();

    $desk = theDeskOf($this->organisation);
    $deskId = (string) $desk->getKey();

    expect(deskOfferings($desk))->toHaveCount(3)
        ->and(deskTariffs($desk))->toHaveCount(1);

    // The counter is now the kitchen's to curate, and this is what a kitchen
    // that has curated it looks like: one dish taken off the counter and left on
    // the site. A backfill written as an upsert would put it back.
    ChannelCatalogueItem::withoutTenancy()
        ->where('sales_channel_id', $deskId)
        ->where('catalogue_item_id', $bowl->getKey())
        ->update(['is_available' => false]);

    runTheDeskBackfill();

    $desk = theDeskOf($this->organisation);

    expect(SalesChannel::withoutTenancy()->where('organisation_id', $this->organisation->getKey())->where('code', 'desk')->count())->toBe(1)
        ->and((string) $desk->getKey())->toBe($deskId)
        ->and(deskOfferings($desk))->toHaveCount(3)
        ->and(deskTariffs($desk))->toHaveCount(1)
        ->and(ChannelCatalogueItem::withoutTenancy()
            ->where('sales_channel_id', $deskId)
            ->where('catalogue_item_id', $bowl->getKey())
            ->sole()
            ->is_available)->toBeFalse();
});
