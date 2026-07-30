<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Consent\Models\ConsentDefinition;
use Healthy360\Features\Models\FeatureDefinition;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Database\Seeders\CountrySeeder;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\ReferenceData\Models\Language;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Support\Facades\Hash;

/*
|--------------------------------------------------------------------------
| Seeders
|--------------------------------------------------------------------------
|
| The seeded catalogue is a contract: reference data, the foundation
| permission set and the platform template roles are what every other module
| and the frontend permission kernel are written against.
|
*/

beforeEach(function (): void {
    $this->seed();
});

it('seeds every ISO country but activates only the launch markets', function (): void {
    expect(Country::query()->count())->toBe(249)
        ->and(Country::query()->where('is_active', true)->count())->toBe(9)
        ->and(Country::query()->where('is_active', true)->orderBy('code')->pluck('code')->all())
        ->toEqualCanonicalizing(CountrySeeder::LAUNCH_MARKETS)
        ->and(Country::query()->whereKey('LB')->value('default_currency_code'))->toBe('LBP')
        ->and(Country::query()->whereKey('KW')->value('default_currency_code'))->toBe('KWD');
});

it('seeds currencies with ISO minor units and activates the launch set plus the majors', function (): void {
    expect(Currency::query()->where('is_active', true)->pluck('code')->all())
        ->toEqualCanonicalizing(['LBP', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'EGP', 'USD', 'EUR', 'GBP'])
        ->and(Currency::query()->whereIn('code', ['KWD', 'BHD', 'OMR', 'JOD'])->pluck('minor_units')->unique()->all())
        ->toBe([3])
        ->and(Currency::query()->whereKey('USD')->value('minor_units'))->toBe(2)
        ->and(Currency::query()->whereKey('JPY')->value('minor_units'))->toBe(0);
});

it('seeds every currency a country defaults to', function (): void {
    $orphans = Country::query()
        ->whereNotNull('default_currency_code')
        ->whereNotIn('default_currency_code', Currency::query()->select('code'))
        ->count();

    expect($orphans)->toBe(0);
});

it('seeds the launch languages with the correct direction', function (): void {
    $languages = Language::query()->get()->keyBy('code');

    expect($languages)->toHaveCount(3)
        ->and($languages['en']->direction)->toBe('ltr')
        ->and($languages['en']->is_active)->toBeTrue()
        ->and($languages['ar']->direction)->toBe('rtl')
        ->and($languages['ar']->is_active)->toBeTrue()
        ->and($languages['fr']->direction)->toBe('ltr')
        ->and($languages['fr']->is_active)->toBeFalse();
});

it('seeds the foundation measurement units', function (): void {
    expect(MeasurementUnit::query()->pluck('code')->all())->toEqualCanonicalizing([
        'g', 'mg', 'kg', 'ml', 'l', 'cm', 'm', 'kcal', 'kJ', 'piece', 'serving', 'tsp', 'tbsp', 'cup',
    ])->and(MeasurementUnit::query()->pluck('unit_system')->unique()->values()->all())
        ->toEqualCanonicalizing(['metric', 'clinical', 'imperial']);
});

it('seeds the twelve organisation types with both names', function (): void {
    expect(OrganisationType::query()->count())->toBe(12)
        ->and(OrganisationType::query()->pluck('code')->all())->toEqualCanonicalizing([
            'clinic', 'healthcare_centre', 'dietitian_practice', 'kitchen', 'restaurant',
            'fitness_centre', 'wellness_provider', 'supplier', 'delivery_provider',
            'corporate_customer', 'insurance_partner', 'platform_operator',
        ])
        ->and(OrganisationType::query()->where('name_ar', '')->orWhereNull('name_ar')->count())->toBe(0);
});

it('seeds exactly the foundation permission set', function (): void {
    expect(Permission::query()->count())->toBe(20)
        ->and(Permission::query()->pluck('code')->all())
        ->toEqualCanonicalizing(PermissionRegistry::codes());
});

it('seeds permission codes in the domain.action_scope format', function (): void {
    foreach (Permission::query()->pluck('code')->all() as $code) {
        expect($code)->toMatch(PermissionRegistry::CODE_FORMAT);
    }
});

it('seeds the platform template roles with the expected grants', function (string $code, int $expectedGrants): void {
    $role = Role::withoutTenancy()->whereNull('organisation_id')->where('code', $code)->sole();

    expect($role->is_system)->toBeTrue()
        ->and($role->organisation_id)->toBeNull()
        ->and(RolePermission::withoutTenancy()->where('role_id', $role->getKey())->count())->toBe($expectedGrants);
})->with([
    'organisation owner grants every foundation permission' => ['organisation_owner', 20],
    'organisation administrator cannot manage roles' => ['organisation_admin', 19],
    'branch manager is limited to its branch and roster' => ['branch_manager', 3],
    'member holds the organisation view plus the own-scope permissions' => ['member', 7],
]);

it('seeds only the four platform template roles', function (): void {
    expect(Role::withoutTenancy()->count())->toBe(4)
        ->and(Role::withoutTenancy()->whereNotNull('organisation_id')->count())->toBe(0);
});

it('withholds role management from the organisation administrator template', function (): void {
    $admin = Role::withoutTenancy()->whereNull('organisation_id')->where('code', 'organisation_admin')->sole();

    $codes = Permission::query()
        ->whereIn('id', RolePermission::withoutTenancy()->where('role_id', $admin->getKey())->select('permission_id'))
        ->pluck('code')
        ->all();

    expect($codes)->not->toContain('role.manage_organisation')
        ->and($codes)->toContain('role.view_organisation');
});

it('seeds the feature catalogue', function (): void {
    expect(FeatureDefinition::query()->pluck('code')->all())->toEqualCanonicalizing([
        'feature.two_factor_enforcement',
        'feature.multi_branch',
        'feature.api_access',
        'feature.audit_export',
    ])->and(FeatureDefinition::query()->where('is_active', true)->count())->toBe(4);
});

it('seeds version one of the consent texts, marked as drafts', function (): void {
    $definitions = ConsentDefinition::query()->get();

    expect($definitions->pluck('code')->all())->toEqualCanonicalizing([
        'consent.terms', 'consent.privacy', 'consent.health_data_processing',
    ])->and($definitions->pluck('version')->unique()->all())->toBe([1]);

    foreach ($definitions as $definition) {
        expect($definition->body_en)->toContain('Draft pending legal review')
            ->and($definition->body_ar)->not->toBe('');
    }
});

it('seeds the demonstration tenants in the testing environment', function (): void {
    $cedar = Organisation::query()->where('slug', 'cedar-clinic')->sole();
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    expect($cedar->country_code)->toBe('LB')
        ->and($cedar->type->code)->toBe('clinic')
        ->and($verdant->country_code)->toBe('AE')
        ->and($verdant->type->code)->toBe('kitchen')
        ->and(OrganisationBranch::withoutTenancy()->where('organisation_id', $cedar->getKey())->pluck('name')->all())
        ->toEqualCanonicalizing(['Hamra', 'Jounieh'])
        ->and(OrganisationBranch::withoutTenancy()->where('organisation_id', $verdant->getKey())->pluck('name')->all())
        ->toBe(['Al Quoz']);
});

it('gives every demonstration user a verified account and a profile', function (string $email): void {
    $user = User::query()->where('email', $email)->sole();

    expect($user->email_verified_at)->not->toBeNull()
        ->and(Hash::check('password', $user->password))->toBeTrue()
        ->and($user->profile)->not->toBeNull();
})->with([
    'owner@cedar.test',
    'dietitian@cedar.test',
    'owner@verdant.test',
    'chef@verdant.test',
    'patient@healthy360.test',
]);

it('places the dietitian in both demonstration organisations', function (): void {
    $dietitian = User::query()->where('email', 'dietitian@cedar.test')->sole();

    $slugs = Organisation::query()
        ->whereIn('id', OrganisationMembership::withoutTenancy()->where('user_id', $dietitian->getKey())->select('organisation_id'))
        ->pluck('slug')
        ->all();

    expect($slugs)->toEqualCanonicalizing(['cedar-clinic', 'verdant-kitchen']);
});

it('scopes the demonstration chef membership to the Al Quoz branch', function (): void {
    $chef = User::query()->where('email', 'chef@verdant.test')->sole();
    $membership = OrganisationMembership::withoutTenancy()->where('user_id', $chef->getKey())->sole();

    $role = Role::withoutTenancy()
        ->whereIn('id', MembershipRole::withoutTenancy()->where('membership_id', $membership->getKey())->select('role_id'))
        ->sole();

    $branch = OrganisationBranch::withoutTenancy()->whereKey($membership->branch_id)->sole();

    expect($branch->name)->toBe('Al Quoz')
        ->and($role->code)->toBe('branch_manager');
});

it('converges instead of duplicating when run a second time', function (): void {
    $before = [
        Country::query()->count(),
        Currency::query()->count(),
        Permission::query()->count(),
        Role::withoutTenancy()->count(),
        RolePermission::withoutTenancy()->count(),
        Organisation::query()->count(),
        OrganisationBranch::withoutTenancy()->count(),
        OrganisationMembership::withoutTenancy()->count(),
        MembershipRole::withoutTenancy()->count(),
        User::query()->count(),
    ];

    $this->seed();

    expect([
        Country::query()->count(),
        Currency::query()->count(),
        Permission::query()->count(),
        Role::withoutTenancy()->count(),
        RolePermission::withoutTenancy()->count(),
        Organisation::query()->count(),
        OrganisationBranch::withoutTenancy()->count(),
        OrganisationMembership::withoutTenancy()->count(),
        MembershipRole::withoutTenancy()->count(),
        User::query()->count(),
    ])->toBe($before);
});
