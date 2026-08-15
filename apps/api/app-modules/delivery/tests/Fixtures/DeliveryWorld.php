<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Tests\Fixtures;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Tenancy\TenantContext;

/**
 * The world the delivery suites are set in: kitchens with branches, the
 * platform places they can serve, and the zones they draw over them.
 *
 * A fixture class rather than Pest helper functions, for the reason
 * `CatalogueWorld` and `PricingWorld` give: Pest loads every test file in the
 * suite into one process, and four files declaring `deliveryTenant()` would be
 * a fatal redeclaration rather than a test failure.
 *
 * It deliberately does **not** build on `CatalogueWorld`, unlike `PricingWorld`
 * which does. The module registry says Delivery depends on Organisations and
 * ReferenceData and says nothing about Catalogues — a delivery zone knows
 * nothing about what is being delivered — and a test fixture reaching across
 * that boundary would create the dependency edge the registry denies. The
 * duplicated permission plumbing is the price of the boundary being real.
 */
final class DeliveryWorld
{
    /**
     * What a kitchen manager holds over delivery configuration. One code: a
     * screen that showed the map without letting somebody change it is not a
     * screen anybody asked for (K1.7).
     *
     * @var list<string>
     */
    public const array FULL_PERMISSIONS = [
        'delivery_zone.manage_organisation',
        'branch.view_current',
        'branch.manage_current',
    ];

    /**
     * A kitchen organisation built on seeded reference data.
     *
     * Not `Organisation::factory()` unadorned: that factory invents a country,
     * a currency and a language, and inventing an ISO code on top of the ones
     * the seeder already wrote is a primary-key collision waiting to happen.
     */
    public static function organisation(string $countryCode = 'LB', string $currencyCode = 'USD'): Organisation
    {
        return Organisation::factory()->create([
            'organisation_type_id' => OrganisationType::query()->where('code', 'kitchen')->sole()->getKey(),
            'country_code' => $countryCode,
            'default_currency_code' => $currencyCode,
            'default_language_code' => 'en',
        ]);
    }

    /**
     * A tenant whose user holds the named permissions and nothing else, with
     * two branches — because every interesting rule in this module is about
     * the difference between one branch's map and another's.
     *
     * @param  list<string>  $permissions
     */
    public static function kitchen(string $email, array $permissions = self::FULL_PERMISSIONS, string $countryCode = 'LB'): object
    {
        $organisation = self::organisation($countryCode);
        $user = User::factory()->create(['email' => $email]);

        $membership = OrganisationMembership::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'user_id' => $user->getKey(),
        ]);

        $role = Role::factory()->create(['organisation_id' => $organisation->getKey()]);

        foreach ($permissions as $code) {
            RolePermission::factory()->create([
                'organisation_id' => $organisation->getKey(),
                'role_id' => $role->getKey(),
                'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
            ]);
        }

        MembershipRole::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'membership_id' => $membership->getKey(),
            'role_id' => $role->getKey(),
        ]);

        $branch = self::branch($organisation, 'Main kitchen');
        $secondBranch = self::branch($organisation, 'Second kitchen');

        return (object) compact('organisation', 'user', 'membership', 'role', 'branch', 'secondBranch');
    }

    public static function branch(Organisation $organisation, string $name): OrganisationBranch
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
     * @return array<string, string>
     */
    public static function headers(object $tenant): array
    {
        return firstPartyHeaders() + ['X-Organisation-Id' => (string) $tenant->organisation->getKey()];
    }

    /**
     * @return array<string, string>
     */
    public static function branchHeaders(object $tenant, ?OrganisationBranch $branch = null): array
    {
        return self::headers($tenant) + ['X-Branch-Id' => (string) ($branch ?? $tenant->branch)->getKey()];
    }

    /**
     * Put the tenant context where an HTTP request would have left it.
     *
     * Needed only by tests that call a service directly: `actingAs()`
     * authenticates but resolves no organisation, and every model here is
     * fail-closed without one. A test driving the API through HTTP gets the
     * context from `org.context` and does not need this.
     */
    public static function enterContext(object $tenant): void
    {
        app(TenantContext::class)->setOrganisation(
            (string) $tenant->user->getKey(),
            (string) $tenant->organisation->getKey(),
        );
    }

    /**
     * A platform place. Written directly rather than through a seeder so a
     * suite can build the two or three areas it needs instead of the whole
     * 125-row gazetteer.
     */
    public static function area(string $code, string $countryCode = 'LB', bool $active = true): DeliveryArea
    {
        return DeliveryArea::query()->create([
            'country_code' => $countryCode,
            'code' => $code,
            'name_en' => ucfirst(str_replace('-', ' ', $code)),
            'name_ar' => 'منطقة '.$code,
            'region' => null,
            'display_order' => 0,
            'is_active' => $active,
        ]);
    }

    /**
     * A zone, organisation-wide unless a branch is named.
     */
    public static function zone(Organisation $organisation, string $code = 'inner', ?OrganisationBranch $branch = null): DeliveryZone
    {
        $factory = DeliveryZone::factory();

        if ($branch !== null) {
            $factory = $factory->forBranch((string) $branch->getKey());
        }

        return $factory->create([
            'organisation_id' => $organisation->getKey(),
            'code' => $code,
            'currency_code' => $organisation->default_currency_code,
        ]);
    }

    /**
     * A claim written directly, so a test can build the *state* it wants to
     * assert about without asserting the set-replace diff on the way in. The
     * `branch_id` copy is made here exactly as `ZoneAreaService` makes it.
     */
    public static function claim(DeliveryZone $zone, DeliveryArea $area): DeliveryZoneArea
    {
        return DeliveryZoneArea::withoutTenancy()->create([
            'organisation_id' => $zone->organisation_id,
            'delivery_zone_id' => $zone->getKey(),
            'delivery_area_id' => $area->getKey(),
            'branch_id' => $zone->branch_id,
        ]);
    }
}
