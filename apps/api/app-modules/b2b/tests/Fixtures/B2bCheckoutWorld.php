<?php

declare(strict_types=1);

namespace Healthy360\B2b\Tests\Fixtures;

use App\Models\User;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Models\DeliveryArea;

/**
 * A seller kitchen with a wholesale channel and one or more corporate buyers
 * holding negotiated tariffs.
 */
final class B2bCheckoutWorld
{
    /**
     * One seller, one wholesale channel, one meal, and two buyer orgs each with
     * their own agreement price on the same article.
     *
     * @return array{
     *     seller: object,
     *     channel: SalesChannel,
     *     publicList: PriceList,
     *     meal: CatalogueItem,
     *     area: DeliveryArea,
     *     buyers: array{
     *         acme: array{organisation: Organisation, account: CustomerAccount, user: User, agreement: B2bAgreement, agreementList: PriceList, priceMinor: int, headers: array<string, string>},
     *         beta: array{organisation: Organisation, account: CustomerAccount, user: User, agreement: B2bAgreement, agreementList: PriceList, priceMinor: int, headers: array<string, string>},
     *     }
     * }
     */
    public static function dualAgreement(string $sellerEmail = 'wholesale@kitchen.test'): array
    {
        $seller = PricingWorld::kitchen($sellerEmail);
        $organisation = $seller->organisation;

        $branch = CheckoutWorld::branch($organisation);
        $channel = SalesChannel::factory()->wholesale()->create([
            'organisation_id' => $organisation->getKey(),
            'code' => 'wholesale',
            'channel_kind' => SalesChannelKind::B2b,
        ]);

        $publicList = PricingWorld::priceList($organisation, 'trade-usd', active: true);
        PricingWorld::assign($channel, $publicList, priority: 1);

        $meal = CheckoutWorld::publishedMeal($seller);
        CheckoutWorld::offer($channel, $meal);
        PricingWorld::price($publicList, $meal, null, 3000);

        $area = CheckoutWorld::area('b2b-'.substr(md5($sellerEmail), 0, 6));
        CheckoutWorld::servingZone($organisation, $area);

        $buyers = [
            'acme' => self::buyerWithAgreement($seller, $channel, $meal, 'acme', 1800, $area),
            'beta' => self::buyerWithAgreement($seller, $channel, $meal, 'beta', 2200, $area),
        ];

        return compact('seller', 'channel', 'publicList', 'meal', 'area', 'branch', 'buyers');
    }

    /**
     * @return array{
     *     organisation: Organisation,
     *     account: CustomerAccount,
     *     user: User,
     *     agreement: B2bAgreement,
     *     agreementList: PriceList,
     *     priceMinor: int,
     *     address: CustomerAddress,
     *     headers: array<string, string>,
     * }
     */
    public static function buyerWithAgreement(
        object $seller,
        SalesChannel $channel,
        CatalogueItem $meal,
        string $slug,
        int $priceMinor,
        DeliveryArea $area,
    ): array {
        $world = B2bWorld::provisionedWorld(User::factory()->create(['email' => "buyer-{$slug}@corp.test"]));
        $organisation = $world['organisation'];
        $account = $world['account'];
        $user = $world['signatory'];

        B2bWorld::member($organisation, $user);

        $agreementList = PriceList::factory()->active()->agreement()->create([
            'organisation_id' => $seller->organisation->getKey(),
            'code' => "{$slug}-agreement-usd",
            'currency_code' => $seller->organisation->default_currency_code,
            'customer_scope' => CustomerScope::Agreement,
        ]);

        PricingWorld::assign($channel, $agreementList, priority: 0);
        PricingWorld::price($agreementList, $meal, null, $priceMinor);

        /** @var B2bAgreement $agreement */
        $agreement = $world['agreement'];
        $agreement->price_list_id = (string) $agreementList->getKey();
        $agreement->currency_code = $seller->organisation->default_currency_code;
        $agreement->minimum_order_minor = 1000;
        $agreement->status = AgreementStatus::Active;
        $agreement->save();

        $address = CustomerAddress::query()->create([
            'customer_account_id' => $account->getKey(),
            'address_type' => CustomerAddressType::Delivery,
            'delivery_area_id' => $area->getKey(),
            'label' => 'HQ',
            'line_one' => 'Main street 1',
            'is_default' => true,
            'lock_version' => 0,
        ]);

        return [
            'organisation' => $organisation,
            'account' => $account,
            'user' => $user,
            'agreement' => $agreement,
            'agreementList' => $agreementList,
            'priceMinor' => $priceMinor,
            'address' => $address,
            'headers' => firstPartyHeaders() + ['X-Organisation-Id' => (string) $organisation->getKey()],
        ];
    }
}
