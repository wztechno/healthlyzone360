<?php

declare(strict_types=1);

namespace Healthy360\Orders\Tests\Fixtures;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;

/**
 * The world an order desk sells in: everything a checkout needs, plus a counter
 * to sell it across.
 *
 * A fixture class rather than Pest helper functions, for the reason every other
 * world in this codebase is one: Pest loads the whole suite into one process,
 * and the quote suite and the placement suite both declaring `deskWorld()` would
 * be a fatal redeclaration rather than a test failure. `OrderDeskQueueTest`'s own
 * file-local helpers are safe only because their names are unique to it.
 *
 * It builds **on** `CheckoutWorld` and adds exactly one thing: a second sales
 * channel coded `desk`, carrying the **same tariff and the same assortment** as
 * the web shop. That mirroring is the whole point of the fixture — it is what
 * the backfill migration arranged for every kitchen that predates the desk, and
 * it is what makes "a quote prices identically to the web shop" a meaningful
 * assertion rather than a coincidence of two price lists that happen to agree.
 */
final class DeskWorld
{
    /**
     * What a desk agent holds: read the book, sell across the counter, and
     * confirm what they sold.
     *
     * A subset of the seeded `order_desk_agent` template rather than a copy of
     * it — this is what the two desk endpoints actually spend, and a fixture
     * granting more would stop a missing `permission:` middleware from failing.
     *
     * @var list<string>
     */
    public const array AGENT_PERMISSIONS = [
        'order.view_organisation',
        'order.create_on_behalf_organisation',
    ];

    /**
     * A kitchen that can sell across a counter, and everything it needs to.
     *
     * Returns `CheckoutWorld`'s object with one property added: `desk`, the
     * `pos` channel coded `desk` that `DeskChannelLocator` resolves.
     */
    public static function build(string $email = 'desk@kitchen.test', int $unitPriceMinor = 2500, int $deliveryFeeMinor = 500): object
    {
        $world = CheckoutWorld::build($email, $unitPriceMinor, $deliveryFeeMinor);

        $world->desk = self::channel($world);

        return $world;
    }

    /**
     * The counter channel, mirroring the web shop's tariff and assortment.
     *
     * `order_source` is `desk` rather than `pos`, exactly as `KitchenProvisioning`
     * writes it: the deleted POS module bypassed pricing, stock, audit and the
     * order book entirely, and a desk sale is an ordinary order that happened to
     * be taken by a person.
     */
    public static function channel(object $world, string $code = 'desk'): SalesChannel
    {
        $channel = SalesChannel::factory()->create([
            'organisation_id' => $world->organisation->getKey(),
            'code' => $code,
            'channel_kind' => SalesChannelKind::Pos,
            'order_source' => 'desk',
            'name_en' => 'Order desk',
            'name_ar' => 'مكتب الطلبات',
        ]);

        PricingWorld::assign($channel, $world->priceList);
        CheckoutWorld::offer($channel, $world->meal);

        return $channel;
    }

    /**
     * Somebody inside this kitchen holding exactly the named codes, and nothing
     * else — so a suite that omits `order.create_on_behalf_organisation` really
     * is testing a caller who may quote but may not sell.
     *
     * @param  list<string>  $permissions
     */
    public static function agent(object $world, string $email, array $permissions = self::AGENT_PERMISSIONS): User
    {
        $organisationId = (string) $world->organisation->getKey();

        $user = User::factory()->create(['email' => $email]);

        $membership = OrganisationMembership::factory()->create([
            'organisation_id' => $organisationId,
            'user_id' => $user->getKey(),
        ]);

        $role = Role::factory()->create(['organisation_id' => $organisationId]);

        foreach ($permissions as $code) {
            RolePermission::factory()->create([
                'organisation_id' => $organisationId,
                'role_id' => $role->getKey(),
                'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
            ]);
        }

        MembershipRole::factory()->create([
            'organisation_id' => $organisationId,
            'membership_id' => $membership->getKey(),
            'role_id' => $role->getKey(),
        ]);

        return $user;
    }

    /**
     * @return array<string, string>
     */
    public static function headers(object $world): array
    {
        return firstPartyHeaders() + ['X-Organisation-Id' => (string) $world->organisation->getKey()];
    }
}
