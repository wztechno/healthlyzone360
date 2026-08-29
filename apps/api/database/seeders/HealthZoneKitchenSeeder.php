<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Closure;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationCapability;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Seeder;

/**
 * The way into HealthZone360 — three test logins and the production capability.
 *
 * ## Why this is a seeder while the catalogue is not
 *
 * The kitchen's *content* — catalogue, recipes, determinations — belongs to the audited,
 * environment-allowlisted import commands (`kitchen:import-v6`, `kitchen:import-v6-recipes`,
 * `kitchen:apply-allergen-determinations`), which read committed and private documents and write a
 * report. Reimplementing that as a seeder would duplicate the importer and walk around its
 * allowlist. The *logins* are the opposite case: pure structure, no confidential content, and the
 * same shape as {@link PlatformOperatorSeeder} — a reset that leaves a system nobody can open is a
 * reset half done.
 *
 * ## Deliberately not in DatabaseSeeder's default run
 *
 * The organisation is created by `kitchen:import-v6`, which runs *after* seeding. Putting this in
 * the default chain would only ever no-op against a fresh database and teach people to ignore its
 * message. Run it once the import has established the organisation:
 *
 *     php artisan db:seed --class=HealthZoneKitchenSeeder --force
 *
 * Idempotent throughout — every write is an updateOrCreate on its natural key.
 */
class HealthZoneKitchenSeeder extends Seeder
{
    private const string ORGANISATION_SLUG = 'healthzone360-kitchen';

    /** Local-development credentials, the same convention every demo login uses. */
    private const string PASSWORD = 'password';

    public function run(): void
    {
        $organisation = Organisation::query()->where('slug', self::ORGANISATION_SLUG)->first();
        if ($organisation === null) {
            $this->command?->warn(sprintf(
                'Organisation "%s" does not exist yet — run `php artisan kitchen:import-v6 --publish` first, then this seeder.',
                self::ORGANISATION_SLUG,
            ));

            return;
        }

        // Users are global rows and need no tenant session; everything organisation-scoped below
        // is written with the organisation declared to the database session, because
        // `organisation_memberships` and its siblings carry row-level security policies that make
        // undeclared rows invisible and undeclared writes refused.
        $owner = $this->user('owner@healthzone360.test', 'Hala', 'Owner');
        $staff = $this->user('staff@healthzone360.test', 'Sami', 'Staff');
        // A plain consumer: an account with no membership browses and orders like any customer.
        $this->user('customer@healthzone360.test', 'Carla', 'Customer');

        $this->forOrganisation((string) $organisation->getKey(), function () use ($organisation, $owner, $staff): void {
            $branch = OrganisationBranch::withoutTenancy()
                ->where('organisation_id', $organisation->getKey())
                ->orderBy('created_at')
                ->firstOrFail();

            $this->membership($organisation, $owner, null, ['organisation_owner', 'kitchen_manager'], $owner);
            $this->membership($organisation, $staff, (string) $branch->getKey(), ['branch_manager'], $owner);

            OrganisationCapability::withoutTenancy()->updateOrCreate(
                ['organisation_id' => $organisation->getKey(), 'capability' => 'kitchen_production'],
                ['is_enabled' => true, 'created_by' => $owner->getKey()],
            );
        });
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

    private function user(string $email, string $givenName, string $familyName): User
    {
        $user = User::query()->firstOrNew(['email' => $email]);
        $user->password = self::PASSWORD;
        $user->email_verified_at = now();
        $user->save();

        UserProfile::query()->updateOrCreate(
            ['user_id' => $user->getKey()],
            [
                'given_name' => $givenName,
                'family_name' => $familyName,
                'preferred_language_code' => 'en',
                'country_code' => 'LB',
            ],
        );

        return $user;
    }

    /**
     * @param  list<string>  $templateRoleCodes
     */
    private function membership(
        Organisation $organisation,
        User $user,
        ?string $branchId,
        array $templateRoleCodes,
        User $creator,
    ): void {
        $membership = OrganisationMembership::withoutTenancy()->updateOrCreate(
            ['organisation_id' => $organisation->getKey(), 'user_id' => $user->getKey()],
            [
                'branch_id' => $branchId,
                'status' => MembershipStatus::Active,
                'joined_at' => now(),
                'created_by' => $creator->getKey(),
            ],
        );

        foreach ($templateRoleCodes as $code) {
            $role = Role::withoutTenancy()
                ->whereNull('organisation_id')
                ->where('code', $code)
                ->firstOrFail();

            MembershipRole::withoutTenancy()->updateOrCreate(
                ['membership_id' => $membership->getKey(), 'role_id' => $role->getKey()],
                ['organisation_id' => $organisation->getKey(), 'created_by' => $creator->getKey()],
            );
        }
    }
}
