<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Models\CatalogueItemPackComponent;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| kitchen:merge-duplicate-packs
|--------------------------------------------------------------------------
|
| The v6 import gave many items a `b2b` and a `b2c` pack that are the same
| pack. What has to hold: a pair that matches on size, packaging, offers and
| prices, and that nothing live still holds, becomes one pack resolving both
| prices; every other pair is reported and left exactly as it was; a dry run
| writes nothing; a second run has nothing to do; another kitchen is untouched.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    config()->set('kitchens.import.environments', ['local', 'testing']);

    $this->kitchen = function (string $email): object {
        $tenant = PricingWorld::kitchen($email);
        $organisation = $tenant->organisation;

        $shop = PricingWorld::channel($organisation, 'web-shop');
        $shop->channel_kind = SalesChannelKind::B2cWeb;
        $shop->save();

        $business = PricingWorld::channel($organisation, 'wholesale');
        $business->channel_kind = SalesChannelKind::B2b;
        $business->save();

        $retail = PricingWorld::priceList($organisation, 'retail-usd', active: true);
        $trade = PricingWorld::priceList($organisation, 'trade-usd', active: true);
        PricingWorld::assign($shop, $retail);
        PricingWorld::assign($business, $trade);

        return (object) compact('tenant', 'organisation', 'shop', 'business', 'retail', 'trade');
    };

    $this->a = ($this->kitchen)('merge-packs@kitchen.test');

    /*
     * A meal with the importer's two packs, neither the default, sized as
     * asked, priced 1200 at home on the b2c pack and 900 in trade on the b2b one.
     */
    $this->pair = function (object $kitchen, string $name, array $b2cSize = ['1', 'kg'], array $b2bSize = ['1000', 'g']): object {
        $item = PricingWorld::meal($kitchen->tenant, $name);
        $packs = [];

        foreach (['b2c' => $b2cSize, 'b2b' => $b2bSize] as $code => [$quantity, $unit]) {
            $pack = CatalogueItemVariant::withoutTenancy()->create([
                'organisation_id' => $kitchen->organisation->getKey(),
                'catalogue_item_id' => $item->getKey(),
                'variant_type' => 'pack',
                'code' => $code,
                'is_default' => false,
                'status' => 'active',
                'lock_version' => 0,
            ]);

            CatalogueItemPackVariant::factory()->create([
                'catalogue_item_variant_id' => $pack->getKey(),
                'pack_quantity' => $quantity,
                'pack_unit_id' => MeasurementUnit::query()->where('code', $unit)->value('id'),
            ]);

            $packs[$code] = $pack;
        }

        PricingWorld::price($kitchen->retail, $item, $packs['b2c'], 1200);
        PricingWorld::price($kitchen->trade, $item, $packs['b2b'], 900);

        return (object) ['item' => $item, 'b2c' => $packs['b2c'], 'b2b' => $packs['b2b']];
    };

    $this->status = fn (CatalogueItemVariant $pack): VariantStatus => CatalogueItemVariant::withoutTenancy()->whereKey($pack->getKey())->sole()->status;

    $this->run = fn (array $options = []) => $this->artisan('kitchen:merge-duplicate-packs', ['--org' => $this->a->organisation->slug, ...$options]);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

it('merges an identical pair into the b2c pack, which then resolves both prices', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen lasagne');

    ($this->run)()->assertSuccessful();

    $archived = CatalogueItemVariant::withoutTenancy()->whereKey($pair->b2b->getKey())->sole();

    expect($archived->status)->toBe(VariantStatus::Archived)
        ->and($archived->is_default)->toBeFalse()
        ->and($archived->lock_version)->toBe(1)
        ->and(($this->status)($pair->b2c))->toBe(VariantStatus::Active)
        ->and(CatalogueItemVariant::withoutTenancy()->whereKey($pair->b2c->getKey())->sole()->code)->toBe('b2c');

    $resolver = app(PriceResolver::class);
    $itemId = (string) $pair->item->getKey();
    $keptId = (string) $pair->b2c->getKey();

    expect($resolver->currentFor((string) $this->a->shop->getKey(), $itemId, $keptId)?->amountMinor)->toBe(1200)
        ->and($resolver->currentFor((string) $this->a->business->getKey(), $itemId, $keptId)?->amountMinor)->toBe(900)
        ->and($resolver->currentFor((string) $this->a->business->getKey(), $itemId, $keptId)?->catalogueItemVariantId)->toBe($keptId);

    // The archived pack's row is closed, not left standing.
    expect(PriceListItem::withoutTenancy()->where('catalogue_item_variant_id', $pair->b2b->getKey())->openRows()->exists())->toBeFalse()
        ->and(PriceListItem::withoutTenancy()->where('catalogue_item_variant_id', $pair->b2c->getKey())->openRows()->count())->toBe(2)
        ->and(AuditLog::query()->where('action', 'catalogue.duplicate_pack_merged')->where('subject_id', $itemId)->count())->toBe(1);
});

it('keeps the default pack when the default is b2b', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen moussaka');
    $pair->b2b->is_default = true;
    $pair->b2b->save();

    ($this->run)()->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Active)
        ->and(($this->status)($pair->b2c))->toBe(VariantStatus::Archived);

    $resolver = app(PriceResolver::class);

    expect($resolver->currentFor((string) $this->a->shop->getKey(), (string) $pair->item->getKey(), (string) $pair->b2b->getKey())?->amountMinor)->toBe(1200);
});

it('writes nothing on a dry run, and reports what it would do', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen lasagne');
    $rows = PriceListItem::withoutTenancy()->orderBy('id')->get(['id', 'effective_to'])->toArray();

    ($this->run)(['--dry-run' => true])
        ->expectsOutputToContain('would keep b2c, would archive b2b')
        ->expectsOutputToContain('Dry run: 1 merged, 0 skipped.')
        ->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Active)
        ->and(CatalogueItemVariant::withoutTenancy()->whereKey($pair->b2b->getKey())->sole()->lock_version)->toBe(0)
        ->and(PriceListItem::withoutTenancy()->orderBy('id')->get(['id', 'effective_to'])->toArray())->toBe($rows)
        ->and(AuditLog::query()->where('action', 'catalogue.duplicate_pack_merged')->exists())->toBeFalse();
});

it('has nothing to do on a second run', function (): void {
    ($this->pair)($this->a, 'Frozen lasagne');

    ($this->run)()->assertSuccessful();
    $rows = PriceListItem::withoutTenancy()->count();

    ($this->run)()->expectsOutputToContain('0 merged, 0 skipped.')->assertSuccessful();

    expect(PriceListItem::withoutTenancy()->count())->toBe($rows)
        ->and(AuditLog::query()->where('action', 'catalogue.duplicate_pack_merged')->count())->toBe(1);
});

it('leaves another kitchen alone', function (): void {
    $other = ($this->kitchen)('merge-packs-other@kitchen.test');
    $theirs = ($this->pair)($other, 'Frozen lasagne');

    ($this->run)()->assertSuccessful();

    expect(($this->status)($theirs->b2b))->toBe(VariantStatus::Active)
        ->and(($this->status)($theirs->b2c))->toBe(VariantStatus::Active)
        ->and(PriceListItem::withoutTenancy()->where('catalogue_item_variant_id', $theirs->b2b->getKey())->openRows()->count())->toBe(1);
});

/*
| Every ineligible pair: reported with its reason, and left exactly as it was.
*/

it('skips a pair whose sizes differ', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen lasagne', ['1', 'kg'], ['500', 'g']);

    ($this->run)()->expectsOutputToContain('different sizes')->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Active);
});

it('skips a pair whose packaging differs', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen lasagne');
    $tray = RecipeWorld::packagingItem($this->a->organisation, 'Tray 1 kg', '0.30');

    $component = new CatalogueItemPackComponent;
    $component->organisation_id = $this->a->organisation->getKey();
    $component->catalogue_item_variant_id = (string) $pair->b2b->getKey();
    $component->ingredient_id = (string) $tray->getKey();
    $component->quantity = '1';
    $component->is_container = true;
    $component->save();

    ($this->run)()->expectsOutputToContain('different packaging components')->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Active);
});

it('skips a pair whose prices conflict on an agreement list', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen lasagne');
    $agreement = PriceList::factory()->agreement()->active()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'code' => 'acme-agreement',
        'currency_code' => $this->a->organisation->default_currency_code,
    ]);
    PricingWorld::price($agreement, $pair->item, $pair->b2c, 1000);
    PricingWorld::price($agreement, $pair->item, $pair->b2b, 1100);

    ($this->run)()->expectsOutputToContain('conflicting prices on acme-agreement')->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Active)
        ->and(PriceListItem::withoutTenancy()->where('catalogue_item_variant_id', $pair->b2b->getKey())->openRows()->count())->toBe(2);
});

it('skips a pair whose archived pack carries a quantity tier', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen lasagne');
    PricingWorld::price($this->a->trade, $pair->item, $pair->b2b, 800, minQuantity: 10);

    ($this->run)()->expectsOutputToContain('quantity tier')->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Active)
        ->and(PriceListItem::withoutTenancy()->where('catalogue_item_variant_id', $pair->b2b->getKey())->openRows()->count())->toBe(2);
});

it('skips a pair when only one pack has its own channel offer', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen lasagne');
    ChannelCatalogueItem::factory()->create([
        'catalogue_item_id' => $pair->item->getKey(),
        'sales_channel_id' => $this->a->business->getKey(),
        'catalogue_item_variant_id' => $pair->b2b->getKey(),
    ]);

    ($this->run)()->expectsOutputToContain('different per-pack channel offers')->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Active);
});

it('skips a pair whose other pack sits in an open cart', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen lasagne');
    $cartId = (string) Str::uuid();

    DB::table('carts')->insert([
        'id' => $cartId,
        'organisation_id' => $this->a->organisation->getKey(),
        'customer_account_id' => CustomerAccount::factory()->create()->getKey(),
        'sales_channel_id' => $this->a->business->getKey(),
        'status' => 'open',
        'currency_code' => $this->a->organisation->default_currency_code,
        'expires_at' => now()->addDay(),
        'lock_version' => 0,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    DB::table('cart_items')->insert([
        'id' => (string) Str::uuid(),
        'cart_id' => $cartId,
        'catalogue_item_id' => $pair->item->getKey(),
        'catalogue_item_variant_id' => $pair->b2b->getKey(),
        'quantity' => '1.0000',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    ($this->run)()->expectsOutputToContain('held by 1 open cart line(s)')->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Active);

    // A converted cart is history, and no longer holds it.
    DB::table('carts')->where('id', $cartId)->update(['status' => 'converted']);

    ($this->run)()->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Archived);
});

it('skips a pair whose other pack is on an open quotation line', function (): void {
    $pair = ($this->pair)($this->a, 'Frozen lasagne');
    $programme = CorporateProgramme::factory()->create(['kitchen_organisation_id' => $this->a->organisation->getKey()]);
    $quotation = Quotation::factory()->submitted()->create(['corporate_programme_id' => $programme->getKey()]);
    QuotationLine::factory()->create([
        'quotation_id' => $quotation->getKey(),
        'catalogue_item_id' => $pair->item->getKey(),
        'catalogue_item_variant_id' => $pair->b2b->getKey(),
    ]);

    ($this->run)()->expectsOutputToContain('held by 1 open quotation line(s)')->assertSuccessful();

    expect(($this->status)($pair->b2b))->toBe(VariantStatus::Active);
});
