<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationCapability;
use Healthy360\PlatformAdministration\Services\KitchenProvisioning;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Api\Exceptions\ApiException;

/*
|--------------------------------------------------------------------------
| Five writes, one transaction, and none of them optional
|--------------------------------------------------------------------------
|
| `KitchenProvisioning::create()` is the only supported way a kitchen comes into
| existence, and what it writes is the difference between a console success
| message that is true and one that is true in twenty minutes. The organisation
| alone is a workspace that refuses on the first screen: `org.context` needs a
| branch for the kitchen area's `requiresBranch` gate, the workspace reads
| `kitchen_production` to know what it is, a published meal has to be available
| on a `b2c_web` channel before a price can resolve — and, since the Order Desk,
| a walk-in has to have somewhere to be sold.
|
| The desk assertion is the one worth spelling out. A kitchen that can take a web
| order but not a counter one is half-provisioned, and the failure is silent: the
| desk's placement path refuses with a missing-channel conflict rather than with
| anything a kitchen manager could act on. So the fifth write is pinned by kind,
| status and `order_source` rather than by its mere existence — `pos` is what the
| resolver branches on, and `desk` is what an order arriving through it calls
| itself, deliberately not the deleted POS module's `pos`.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->operator = User::factory()->create(['email' => 'ops@provisioning.test']);

    $this->provision = fn (array $overrides = []): Organisation => app(KitchenProvisioning::class)->create([
        'name_en' => 'Cedar Table',
        'name_ar' => 'مائدة الأرز',
        'slug' => 'cedar-table',
        'country_code' => 'LB',
        'default_currency_code' => 'USD',
        'default_language_code' => 'en',
        'timezone' => 'Asia/Beirut',
        'branch_name' => 'Gemmayzeh',
        'city' => 'Beirut',
        ...$overrides,
    ], $this->operator);
});

/**
 * @return array<string, SalesChannel>
 */
function provisionedChannels(Organisation $kitchen): array
{
    return SalesChannel::withoutTenancy()
        ->where('organisation_id', $kitchen->getKey())
        ->get()
        ->keyBy(static fn (SalesChannel $channel): string => $channel->code)
        ->all();
}

it('lands all five writes together', function (): void {
    $kitchen = ($this->provision)();

    expect(OrganisationBranch::withoutTenancy()->where('organisation_id', $kitchen->getKey())->count())->toBe(1)
        ->and(OrganisationCapability::withoutTenancy()
            ->where('organisation_id', $kitchen->getKey())
            ->where('capability', KitchenProvisioning::KITCHEN_CAPABILITY)
            ->where('is_enabled', true)
            ->count())->toBe(1)
        ->and(array_keys(provisionedChannels($kitchen)))->toEqualCanonicalizing(['web-shop', 'desk']);
});

it('opens the counter beside the web shop', function (): void {
    $kitchen = ($this->provision)();
    $desk = provisionedChannels($kitchen)[KitchenProvisioning::DESK_CHANNEL_CODE];

    expect($desk->channel_kind)->toBe(SalesChannelKind::Pos)
        ->and($desk->status)->toBe(SalesChannelStatus::Active)
        // Not `pos`. That was the deleted module's word for a till that bypassed
        // pricing, stock and the order book; a desk sale is an ordinary order a
        // member of staff placed, and every report that groups by this column
        // depends on the two staying apart.
        ->and($desk->order_source)->toBe('desk')
        ->and($desk->created_by)->toBe((string) $this->operator->getKey())
        ->and($desk->name_en)->toBe('Cedar Table order desk')
        ->and($desk->name_ar)->toBe('مكتب طلبات مائدة الأرز');

    // The web shop is untouched by the addition, and is still what a marketplace
    // listing and a consumer price resolve through.
    $shop = provisionedChannels($kitchen)[KitchenProvisioning::DEFAULT_CHANNEL_CODE];

    expect($shop->channel_kind)->toBe(SalesChannelKind::B2cWeb)
        ->and($shop->order_source)->toBe('web');
});

it('opens the desk holding nothing, because a new kitchen has nothing to hold', function (): void {
    // Why the two backfill migrations are for existing kitchens only. There is
    // no catalogue and no tariff a minute after provisioning, so the desk is a
    // faithful mirror of an empty web shop — and stays one as the kitchen
    // assigns items to both.
    $kitchen = ($this->provision)();
    $desk = provisionedChannels($kitchen)[KitchenProvisioning::DESK_CHANNEL_CODE];

    expect(ChannelCatalogueItem::withoutTenancy()->where('sales_channel_id', $desk->getKey())->count())->toBe(0)
        ->and(ChannelPriceList::withoutTenancy()->where('sales_channel_id', $desk->getKey())->count())->toBe(0);
});

it('refuses a slug that is already taken without opening anything', function (): void {
    ($this->provision)();

    expect(fn () => ($this->provision)(['name_en' => 'Cedar Table Two']))
        ->toThrow(ApiException::class);

    // One kitchen, one pair of channels: the refusal happens before the
    // transaction, so nothing half-provisioned is left behind.
    expect(Organisation::query()->where('slug', 'cedar-table')->count())->toBe(1)
        ->and(SalesChannel::withoutTenancy()->where('code', 'desk')->count())->toBe(1);
});
