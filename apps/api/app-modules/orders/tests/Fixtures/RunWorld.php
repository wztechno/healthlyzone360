<?php

declare(strict_types=1);

namespace Healthy360\Orders\Tests\Fixtures;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;

/**
 * An order on its way out of the kitchen: the world the cancel, cash, failure and
 * courier suites all stand in.
 *
 * A fixture class for the reason `DeskWorld` gives: four suites declaring the same
 * helpers would be a fatal redeclaration rather than a test failure.
 */
final class RunWorld
{
    /**
     * @param  list<string>  $permissions  what the world's user holds on top of `CheckoutWorld`
     */
    public static function build(string $email, array $permissions = ['order.view_organisation', 'order.manage_organisation', 'order.supervise_organisation']): object
    {
        $world = CheckoutWorld::build($email);

        self::grant($world, $permissions);

        $world->headers = PricingWorld::headers($world->tenant);
        $world->ownerAlerted = self::member((string) $world->organisation->getKey(), 'organisation_owner');

        return $world;
    }

    /**
     * @param  list<string>  $permissions
     */
    public static function grant(object $world, array $permissions): void
    {
        foreach ($permissions as $code) {
            RolePermission::factory()->create([
                'organisation_id' => $world->organisation->getKey(),
                'role_id' => $world->tenant->role->getKey(),
                'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
            ]);
        }
    }

    /**
     * A confirmed delivery order totalling 3000.
     *
     * @param  array<string, mixed>  $attributes
     */
    public static function order(object $world, array $attributes = []): Order
    {
        return Order::factory()->confirmed()->create([
            'organisation_id' => $world->organisation->getKey(),
            'customer_account_id' => $world->customer->account->getKey(),
            'sales_channel_id' => $world->channel->getKey(),
            ...$attributes,
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public static function job(object $world, Order $order, array $attributes = []): DeliveryJob
    {
        return DeliveryJob::withoutTenancy()->create([
            'organisation_id' => $world->organisation->getKey(),
            'order_id' => $order->getKey(),
            'status' => 'pending',
            'tracking_status' => 'awaiting_assignment',
            'lock_version' => 0,
            ...$attributes,
        ]);
    }

    /**
     * The world's own user, out on the road with this order.
     */
    public static function inTransit(object $world, Order $order): DeliveryJob
    {
        return self::job($world, $order, [
            'driver_user_id' => $world->tenant->user->getKey(),
            'status' => 'in_transit',
            'tracking_status' => 'en_route',
            'assigned_at' => now(),
            'picked_up_at' => now(),
        ]);
    }

    /**
     * A second active member of the kitchen, in a role of their own.
     */
    public static function member(string $organisationId, string $roleCode): User
    {
        $user = User::factory()->create();
        $role = Role::factory()->create(['organisation_id' => $organisationId, 'code' => $roleCode]);

        $membership = OrganisationMembership::factory()->create([
            'organisation_id' => $organisationId,
            'user_id' => $user->getKey(),
        ]);

        MembershipRole::factory()->create([
            'membership_id' => $membership->getKey(),
            'organisation_id' => $organisationId,
            'role_id' => $role->getKey(),
        ]);

        return $user;
    }
}
