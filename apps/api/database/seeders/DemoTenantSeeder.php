<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
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
 * Two demonstration tenants exercising the multi-organisation identity model
 * (plan §9): a Lebanese clinic with two branches, an Emirati kitchen with
 * one, a dietitian who belongs to both, and a patient connected to the
 * clinic.
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
