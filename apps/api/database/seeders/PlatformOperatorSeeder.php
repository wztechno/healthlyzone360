<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Closure;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;

/**
 * The platform operator's own login and workspace — `ops@healthy360.test`,
 * the `healthy360-operations` organisation, and the bespoke `reference_editor`
 * role carrying every platform permission plus the catalogue and inventory
 * pairs.
 *
 * Split out of `DemoTenantSeeder` so a reset without the demo world still
 * produces a usable system: the operator account is the way in, not a demo.
 * `DemoTenantSeeder::seedPlatformOperator()` remains and converges on the
 * same rows (everything here is `updateOrCreate`), so a test run that seeds
 * the demo world does not conflict with this seeder having run first.
 */
class PlatformOperatorSeeder extends Seeder
{
    private const string DEMO_PASSWORD = 'password';

    public function run(): void
    {
        if (! App::environment(['local', 'testing'])) {
            return;
        }

        $ops = $this->user('ops@healthy360.test', 'Yara', 'Deeb', 'en', 'LB');

        $platform = $this->organisation('Healthy360 Operations', 'healthy360-operations', 'platform_operator', 'LB', 'USD', 'en', $ops);

        $membership = $this->membership($platform, $ops, 'member', $ops);

        $role = $this->forOrganisation((string) $platform->getKey(), fn (): Role => Role::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $platform->getKey(), 'code' => 'reference_editor'],
            [
                'name_en' => 'Reference editor',
                'name_ar' => 'محرّر البيانات المرجعية',
                'is_system' => false,
                'created_by' => $ops->getKey(),
            ],
        ));

        $codes = [
            ...array_keys(PermissionRegistry::platformPermissions()),
            'catalogue.view_organisation',
            'catalogue.manage_organisation',
            'inventory.view_organisation',
            'inventory.manage_organisation',
            'inventory.view_costs_organisation',
        ];

        foreach ($codes as $code) {
            $permission = Permission::query()->where('code', $code)->firstOrFail();

            RolePermission::withoutTenancy()->updateOrCreate(
                ['role_id' => $role->getKey(), 'permission_id' => $permission->getKey()],
                ['organisation_id' => $platform->getKey()],
            );
        }

        MembershipRole::withoutTenancy()->updateOrCreate(
            ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
            ['organisation_id' => $platform->getKey(), 'created_by' => $ops->getKey()],
        );
    }

    private function user(string $email, string $givenName, string $familyName, string $languageCode, string $countryCode): User
    {
        $user = User::query()->firstOrNew(['email' => $email]);
        $user->password = self::DEMO_PASSWORD;
        $user->email_verified_at = now();
        $user->save();

        UserProfile::query()->updateOrCreate(
            ['user_id' => $user->getKey()],
            [
                'given_name' => $givenName,
                'family_name' => $familyName,
                'preferred_language_code' => $languageCode,
                'country_code' => $countryCode,
                'timezone' => 'Asia/Beirut',
                'numbering_system' => 'latn',
                'created_by' => $user->getKey(),
            ],
        );

        return $user;
    }

    private function organisation(
        string $name,
        string $slug,
        string $typeCode,
        string $countryCode,
        string $currencyCode,
        string $languageCode,
        User $creator,
    ): Organisation {
        $type = OrganisationType::query()->where('code', $typeCode)->firstOrFail();

        return Organisation::query()->updateOrCreate(
            ['slug' => $slug],
            [
                'organisation_type_id' => $type->getKey(),
                'name' => $name,
                'country_code' => $countryCode,
                'default_currency_code' => $currencyCode,
                'default_language_code' => $languageCode,
                'status' => OrganisationStatus::Active,
                'created_by' => $creator->getKey(),
            ],
        );
    }

    /**
     * @template TReturn
     *
     * @param  Closure(): TReturn  $callback
     * @return TReturn
     */
    private function forOrganisation(string $organisationId, Closure $callback): mixed
    {
        return app(DatabaseTenantContext::class)->during(null, $organisationId, null, $callback);
    }

    private function membership(Organisation $organisation, User $user, string $templateRoleCode, User $creator): OrganisationMembership
    {
        $membership = $this->forOrganisation((string) $organisation->getKey(), fn (): OrganisationMembership => OrganisationMembership::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'user_id' => $user->getKey()],
            [
                'branch_id' => null,
                'status' => MembershipStatus::Active,
                'joined_at' => now(),
                'created_by' => $creator->getKey(),
            ],
        ));

        $role = Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('code', $templateRoleCode)
            ->firstOrFail();

        MembershipRole::withoutTenancy()->updateOrCreate(
            ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
            ['organisation_id' => $organisation->getKey(), 'created_by' => $creator->getKey()],
        );

        return $membership;
    }
}
