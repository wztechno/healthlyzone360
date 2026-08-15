<?php

declare(strict_types=1);

namespace Healthy360\Cart\Tests\Fixtures;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Models\DeliveryArea;

/**
 * The world a checkout happens in: a kitchen that sells something through a
 * priced channel, a customer who is allowed to order, and an address the
 * kitchen delivers to.
 *
 * A fixture class rather than Pest helper functions, for the reason every
 * other module world gives: Pest loads every test file in the suite into one
 * process, and two files declaring `checkoutTenant()` would be a fatal
 * redeclaration rather than a test failure.
 *
 * It builds **on** `PricingWorld` — and therefore on `CatalogueWorld` — rather
 * than beside them. Cart depends on Catalogues and Pricing, so this is the
 * legal direction, and the permission plumbing and organisation shape are
 * already solved there. It reaches into Delivery, Customers and Kitchens
 * directly, which the registry's Orders edges permit and which duplicating
 * would not improve.
 *
 * Deliberately not a full `$this->seed()`. These suites need currencies,
 * measurement units, organisation types and the permission catalogue; they do
 * not need the 213-row ingredient library or the 125-area gazetteer, and they
 * must **not** have the consent definitions — a seeded required consent would
 * make every customer here unready to order for a reason none of these tests
 * are about.
 */
final class CheckoutWorld
{
    /**
     * A complete orderable world.
     *
     * Returns the kitchen tenant, its channel and price list, one published
     * and priced meal, a customer who satisfies every activation requirement,
     * their address, and the zone that delivers to it.
     */
    public static function build(string $email = 'checkout@kitchen.test', int $unitPriceMinor = 2500, int $deliveryFeeMinor = 500): object
    {
        $tenant = PricingWorld::kitchen($email);
        $organisation = $tenant->organisation;

        $branch = self::branch($organisation);
        $channel = PricingWorld::channel($organisation, 'web-shop');
        $priceList = PricingWorld::priceList($organisation, 'web-usd', active: true);
        PricingWorld::assign($channel, $priceList);

        $meal = self::publishedMeal($tenant);
        self::offer($channel, $meal);
        PricingWorld::price($priceList, $meal, null, $unitPriceMinor);

        $area = self::area('achrafieh-'.substr(md5($email), 0, 6));
        $zone = self::servingZone($organisation, $area, $deliveryFeeMinor);

        $customer = self::readyCustomer($area);

        return (object) compact(
            'tenant', 'organisation', 'branch', 'channel', 'priceList',
            'meal', 'area', 'zone', 'customer',
        );
    }

    /**
     * A customer who satisfies every activation requirement the evaluator
     * checks: a verified email, a declared dietary answer and a delivery
     * address in an area somebody serves.
     *
     * Phone verification is not arranged, deliberately — gate A-011 is off by
     * default, and a fixture that satisfied a requirement nobody makes would
     * hide the day somebody turned it on.
     */
    public static function readyCustomer(DeliveryArea $area, string $label = 'Home'): object
    {
        $account = CustomerAccount::factory()->active()->create();

        ContactPoint::factory()->verified()->create([
            'user_id' => $account->user_id,
            'is_login_identity' => true,
            'is_primary' => true,
        ]);

        CustomerDietaryProfile::factory()->declaresNoAllergens()->create([
            'customer_account_id' => $account->getKey(),
        ]);

        $address = CustomerAddress::query()->create([
            'customer_account_id' => $account->getKey(),
            'address_type' => CustomerAddressType::Delivery,
            'delivery_area_id' => $area->getKey(),
            'label' => $label,
            'line_one' => 'Rue Gouraud 12',
            'is_default' => true,
            'lock_version' => 0,
        ]);

        return (object) compact('account', 'address');
    }

    public static function branch(Organisation $organisation, string $name = 'Main kitchen'): OrganisationBranch
    {
        return OrganisationBranch::withoutTenancy()->create([
            'organisation_id' => $organisation->getKey(),
            'name' => $name,
            'country_code' => $organisation->country_code,
            'city' => 'Beirut',
            'timezone' => 'Asia/Beirut',
            'status' => 'active',
            'lock_version' => 0,
        ]);
    }

    /**
     * A branch that closes ordering for a day at the given clock face, on
     * every weekday — so a test can state one cut-off rather than seven.
     */
    public static function cutOff(OrganisationBranch $branch, string $at = '15:00:00'): void
    {
        foreach ([1, 2, 3, 4, 5, 6, 7] as $weekday) {
            BranchOpeningHour::withoutTenancy()->create([
                'organisation_id' => $branch->organisation_id,
                'branch_id' => $branch->getKey(),
                'weekday' => $weekday,
                'opens_at' => '09:00:00',
                'closes_at' => '18:00:00',
                'order_cut_off_at' => $at,
            ]);
        }
    }

    /** A published meal — the only status a customer may buy. */
    public static function publishedMeal(object $tenant, string $nameEn = 'Chicken freekeh bowl'): CatalogueItem
    {
        $meal = PricingWorld::meal($tenant, $nameEn);
        $meal->status = 'published';
        $meal->save();

        return $meal;
    }

    /** The channel offers the article, with no window — always available. */
    public static function offer(SalesChannel $channel, CatalogueItem $item, ?CatalogueItemVariant $variant = null): ChannelCatalogueItem
    {
        return ChannelCatalogueItem::withoutTenancy()->create([
            'organisation_id' => $channel->organisation_id,
            'sales_channel_id' => $channel->getKey(),
            'catalogue_item_id' => $item->getKey(),
            'catalogue_item_variant_id' => $variant?->getKey(),
            'is_available' => true,
        ]);
    }

    public static function area(string $code, string $countryCode = 'LB'): DeliveryArea
    {
        return DeliveryArea::query()->create([
            'country_code' => $countryCode,
            'code' => $code,
            'name_en' => 'Achrafieh',
            'name_ar' => 'الأشرفية',
            'region' => null,
            'display_order' => 0,
            'is_active' => true,
        ]);
    }

    /**
     * An organisation-wide zone claiming the area, at a stated fee.
     */
    public static function servingZone(Organisation $organisation, DeliveryArea $area, int $feeMinor = 500, string $code = 'inner'): DeliveryZone
    {
        $zone = DeliveryZone::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'code' => $code,
            'currency_code' => $organisation->default_currency_code,
            'delivery_fee_minor' => $feeMinor,
            'status' => 'active',
        ]);

        DeliveryZoneArea::withoutTenancy()->create([
            'organisation_id' => $organisation->getKey(),
            'delivery_zone_id' => $zone->getKey(),
            'delivery_area_id' => $area->getKey(),
            'branch_id' => null,
        ]);

        return $zone;
    }

    /**
     * A second active price list on the same channel, in another currency —
     * the shape the cross-currency refusal is proved against.
     */
    public static function foreignPriceList(Organisation $organisation, SalesChannel $channel, string $currencyCode, int $priority = 5): PriceList
    {
        $list = PriceList::factory()->active()->create([
            'organisation_id' => $organisation->getKey(),
            'code' => 'tariff-'.strtolower($currencyCode),
            'currency_code' => $currencyCode,
        ]);

        PricingWorld::assign($channel, $list, $priority);

        return $list;
    }
}
