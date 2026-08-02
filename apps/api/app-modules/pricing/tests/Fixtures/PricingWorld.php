<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Tests\Fixtures;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;

/**
 * The world the pricing suites are set in: kitchens that can price things, the
 * articles they price, and the channels they price through.
 *
 * A fixture class rather than Pest helper functions, for the reason
 * `RecipeWorld` and `CatalogueWorld` give: Pest loads every test file in the
 * suite into one process, and four files declaring `pricingTenant()` would be
 * a fatal redeclaration rather than a test failure.
 *
 * It builds **on** `CatalogueWorld` rather than beside it. The permission
 * plumbing, the organisation shape and the reference-data assumptions are
 * already solved there, and a second copy would drift the first time a role
 * changed. The dependency runs the way the module registry says it does —
 * Pricing depends on Catalogues — so this is the legal direction.
 */
final class PricingWorld
{
    /**
     * What a kitchen manager holds once prices exist: everything
     * `CatalogueWorld` grants, plus the pricing pair.
     *
     * @var list<string>
     */
    public const array FULL_PERMISSIONS = [
        ...CatalogueWorld::FULL_PERMISSIONS,
        'price_list.view_organisation',
        'price_list.manage_organisation',
    ];

    /**
     * A kitchen whose user holds the named permissions and nothing else.
     *
     * @param  list<string>  $permissions
     */
    public static function kitchen(string $email, array $permissions = self::FULL_PERMISSIONS): object
    {
        return CatalogueWorld::kitchen($email, $permissions);
    }

    /**
     * @return array<string, string>
     */
    public static function headers(object $tenant): array
    {
        return CatalogueWorld::headers($tenant);
    }

    /**
     * A product with one active pack — the smallest thing a price can point at.
     */
    public static function product(object $tenant, string $nameEn = 'Harissa paste', string $variantCode = 'jar-250g'): object
    {
        $item = CatalogueItem::factory()->create([
            'catalogue_id' => $tenant->catalogue->getKey(),
            'organisation_id' => $tenant->organisation->getKey(),
            'name_en' => $nameEn,
            'name_ar' => 'معجون الهريسة',
        ]);

        $variant = CatalogueItemVariant::withoutTenancy()->create([
            'organisation_id' => $tenant->organisation->getKey(),
            'catalogue_item_id' => $item->getKey(),
            'variant_type' => 'pack',
            'code' => $variantCode,
            'is_default' => true,
            'status' => 'active',
            'lock_version' => 0,
        ]);

        return (object) compact('item', 'variant');
    }

    /**
     * A meal — an article with no variants, priced as itself.
     */
    public static function meal(object $tenant, string $nameEn = 'Chicken freekeh bowl'): CatalogueItem
    {
        return CatalogueItem::factory()->meal()->create([
            'catalogue_id' => $tenant->catalogue->getKey(),
            'organisation_id' => $tenant->organisation->getKey(),
            'name_en' => $nameEn,
            'name_ar' => 'وعاء الفريكة بالدجاج',
        ]);
    }

    public static function channel(Organisation $organisation, string $code = 'web-shop'): SalesChannel
    {
        return SalesChannel::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'code' => $code,
        ]);
    }

    /**
     * A price list in the organisation's own currency, draft unless asked
     * otherwise.
     */
    public static function priceList(Organisation $organisation, string $code = 'web-usd', bool $active = false): PriceList
    {
        $factory = PriceList::factory();

        return ($active ? $factory->active() : $factory)->create([
            'organisation_id' => $organisation->getKey(),
            'code' => $code,
            'currency_code' => $organisation->default_currency_code,
        ]);
    }

    /**
     * A standing row, written directly rather than through the service — so a
     * test can build the *state* it wants to assert about without asserting
     * the diff on the way in.
     */
    public static function price(
        PriceList $priceList,
        CatalogueItem $item,
        ?CatalogueItemVariant $variant = null,
        ?int $amountMinor = 1500,
        ?float $minQuantity = null,
        PriceStatus $status = PriceStatus::Confirmed,
        ?CarbonImmutable $from = null,
        ?CarbonImmutable $to = null,
    ): PriceListItem {
        return PriceListItem::withoutTenancy()->create([
            'organisation_id' => $priceList->organisation_id,
            'price_list_id' => $priceList->getKey(),
            'catalogue_item_id' => $item->getKey(),
            'catalogue_item_variant_id' => $variant?->getKey(),
            'min_quantity' => $minQuantity === null ? null : number_format($minQuantity, 4, '.', ''),
            'unit_amount_minor' => $status === PriceStatus::Confirmed ? $amountMinor : null,
            'price_status' => $status,
            'effective_from' => $from ?? CarbonImmutable::now()->startOfDay(),
            'effective_to' => $to,
        ]);
    }

    public static function assign(SalesChannel $channel, PriceList $priceList, int $priority = 0): ChannelPriceList
    {
        return ChannelPriceList::withoutTenancy()->create([
            'organisation_id' => $priceList->organisation_id,
            'sales_channel_id' => $channel->getKey(),
            'price_list_id' => $priceList->getKey(),
            'priority' => $priority,
        ]);
    }
}
