<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationCapability;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Log;

/**
 * Demonstration tenants exercising the multi-organisation identity model
 * (plan §9): a Lebanese clinic with two branches, an Emirati kitchen with
 * one, a dietitian who belongs to both, a patient connected to the clinic,
 * and — since K1.1 — the platform operator's own organisation.
 *
 * The platform organisation is what makes the platform-permission split
 * demonstrable rather than theoretical. `reference.*_platform` cannot be
 * granted through a template role (an organisation template must never carry
 * a platform code), so it is granted the only way it ever will be: a bespoke
 * organisation-scoped role inside an organisation whose *type* is
 * `platform_operator`. Both gates — the type and the grant — are visible in
 * one place, and the feature tests use exactly this path.
 *
 * Guarded to local and testing environments: these accounts share one
 * well-known password and must never reach a deployed environment.
 *
 * Writes go through withoutTenancy() — seeding is an explicit, auditable
 * cross-tenant path, and every organisation_id is set from the row being
 * created rather than from an ambient context.
 */
class DemoTenantSeeder extends Seeder
{
    private const string DEMO_PASSWORD = 'password';

    public function run(): void
    {
        if (! App::environment(['local', 'testing'])) {
            Log::warning('DemoTenantSeeder skipped: demo tenants are seeded in local and testing environments only.');

            return;
        }

        $cedarOwner = $this->user('owner@cedar.test', 'Nadia', 'Haddad', 'ar', 'LB');
        $dietitian = $this->user('dietitian@cedar.test', 'Rami', 'Khoury', 'en', 'LB');
        $verdantOwner = $this->user('owner@verdant.test', 'Layla', 'Mansour', 'ar', 'AE');
        $chef = $this->user('chef@verdant.test', 'Omar', 'Saleh', 'en', 'AE');
        $patient = $this->user('patient@healthy360.test', 'Maya', 'Aoun', 'en', 'LB');

        $cedar = $this->organisation('Cedar Clinic', 'cedar-clinic', 'clinic', 'LB', 'LBP', 'ar', $cedarOwner);
        $hamra = $this->branch($cedar, 'Hamra', 'Beirut', 'Asia/Beirut', $cedarOwner);
        $this->branch($cedar, 'Jounieh', 'Jounieh', 'Asia/Beirut', $cedarOwner);
        $this->capability($cedar, 'clinic_services', $cedarOwner);

        $verdant = $this->organisation('Verdant Kitchen', 'verdant-kitchen', 'kitchen', 'AE', 'AED', 'ar', $verdantOwner);
        $alQuoz = $this->branch($verdant, 'Al Quoz', 'Dubai', 'Asia/Dubai', $verdantOwner);
        $this->capability($verdant, 'kitchen_production', $verdantOwner);

        $this->membership($cedar, $cedarOwner, null, 'organisation_owner', $cedarOwner);
        $this->membership($cedar, $dietitian, $hamra, 'member', $cedarOwner);
        $this->membership($cedar, $patient, null, 'member', $cedarOwner);

        $this->membership($verdant, $verdantOwner, null, 'organisation_owner', $verdantOwner);
        $this->membership($verdant, $chef, $alQuoz, 'branch_manager', $verdantOwner);

        // The dietitian practises at Cedar and is a plain member at Verdant:
        // one global identity, two organisations, different roles.
        $this->membership($verdant, $dietitian, null, 'member', $verdantOwner);

        // The kitchen owner also runs the catalogue — the K1.1 acceptance path
        // starts here. Template roles are reconciled by TemplateRoleSeeder, so
        // widening kitchen_manager in a later slice reaches this membership
        // without touching this file.
        $this->addRole($verdant, $verdantOwner, 'kitchen_manager', $verdantOwner);

        $this->seedPlatformOperator();
    }

    /**
     * The platform operator's own workspace, and the only supported way to
     * hold a platform permission.
     */
    private function seedPlatformOperator(): void
    {
        $ops = $this->user('ops@healthy360.test', 'Yara', 'Deeb', 'en', 'LB');

        $platform = $this->organisation('Healthy360 Operations', 'healthy360-operations', 'platform_operator', 'LB', 'USD', 'en', $ops);

        $this->membership($platform, $ops, null, 'member', $ops);

        // A bespoke, organisation-scoped role — deliberately not a template.
        // Template roles are built from organisationPermissions() alone, so no
        // template can ever carry a platform code; this is what "granted
        // deliberately, one organisation at a time" looks like in practice.
        $role = Role::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $platform->getKey(), 'code' => 'reference_editor'],
            [
                'name_en' => 'Reference editor',
                'name_ar' => 'محرّر البيانات المرجعية',
                'is_system' => false,
                'created_by' => $ops->getKey(),
            ],
        );

        foreach (array_keys(PermissionRegistry::platformPermissions()) as $code) {
            $permission = Permission::query()->where('code', $code)->firstOrFail();

            RolePermission::withoutTenancy()->updateOrCreate(
                ['role_id' => $role->getKey(), 'permission_id' => $permission->getKey()],
                ['organisation_id' => $platform->getKey()],
            );
        }

        // Platform operators also curate the shared ingredient library, which
        // is an organisation-scoped capability like any other.
        foreach (['catalogue.view_organisation', 'catalogue.manage_organisation'] as $code) {
            $permission = Permission::query()->where('code', $code)->firstOrFail();

            RolePermission::withoutTenancy()->updateOrCreate(
                ['role_id' => $role->getKey(), 'permission_id' => $permission->getKey()],
                ['organisation_id' => $platform->getKey()],
            );
        }

        $membership = OrganisationMembership::withoutTenancy()
            ->where('organisation_id', $platform->getKey())
            ->where('user_id', $ops->getKey())
            ->firstOrFail();

        MembershipRole::withoutTenancy()->updateOrCreate(
            ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
            ['organisation_id' => $platform->getKey(), 'created_by' => $ops->getKey()],
        );
    }

    /**
     * Add a second template role to an existing membership.
     */
    private function addRole(Organisation $organisation, User $user, string $templateRoleCode, User $creator): void
    {
        $membership = OrganisationMembership::withoutTenancy()
            ->where('organisation_id', $organisation->getKey())
            ->where('user_id', $user->getKey())
            ->firstOrFail();

        $role = Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('code', $templateRoleCode)
            ->firstOrFail();

        MembershipRole::withoutTenancy()->updateOrCreate(
            ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
            ['organisation_id' => $organisation->getKey(), 'created_by' => $creator->getKey()],
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
                'timezone' => $countryCode === 'AE' ? 'Asia/Dubai' : 'Asia/Beirut',
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

    private function branch(Organisation $organisation, string $name, string $city, string $timezone, User $creator): OrganisationBranch
    {
        return OrganisationBranch::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'name' => $name],
            [
                'country_code' => $organisation->country_code,
                'city' => $city,
                'timezone' => $timezone,
                'status' => BranchStatus::Active,
                'created_by' => $creator->getKey(),
            ],
        );
    }

    private function capability(Organisation $organisation, string $capability, User $creator): void
    {
        OrganisationCapability::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'capability' => $capability],
            ['is_enabled' => true, 'created_by' => $creator->getKey()],
        );
    }

    private function membership(
        Organisation $organisation,
        User $user,
        ?OrganisationBranch $branch,
        string $templateRoleCode,
        User $creator,
    ): OrganisationMembership {
        $membership = OrganisationMembership::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'user_id' => $user->getKey()],
            [
                'branch_id' => $branch?->getKey(),
                'status' => MembershipStatus::Active,
                'joined_at' => now(),
                'created_by' => $creator->getKey(),
            ],
        );

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
