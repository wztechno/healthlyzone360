<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\Database\DatabaseTenantContext;

$email = $argv[1] ?? 'admin@healthy360.test';
$password = $argv[2] ?? 'password';

/** @var DatabaseTenantContext $tenantContext */
$tenantContext = app(DatabaseTenantContext::class);

$user = User::query()->firstOrNew(['email' => $email]);
$user->password = $password;
$user->email_verified_at = now();
$user->save();

$userId = $user->getKey();

$tenantContext->asUser($userId, function () use ($userId): void {
    UserProfile::query()->updateOrCreate(
        ['user_id' => $userId],
        [
            'given_name' => 'Admin',
            'family_name' => 'User',
            'preferred_language_code' => 'en',
            'country_code' => 'LB',
            'timezone' => 'Asia/Beirut',
            'numbering_system' => 'latn',
            'created_by' => $userId,
        ],
    );
});

$cedar = Organisation::query()->where('slug', 'cedar-clinic')->firstOrFail();
$platform = Organisation::query()->where('slug', 'healthy360-operations')->firstOrFail();

$cedarId = $cedar->getKey();
$platformId = $platform->getKey();

$tenantContext->during($userId, $cedarId, null, function () use ($userId, $cedarId): void {
    $membership = OrganisationMembership::withoutTenancy()->updateOrCreate(
        ['organisation_id' => $cedarId, 'user_id' => $userId],
        [
            'status' => MembershipStatus::Active,
            'joined_at' => now(),
            'created_by' => $userId,
        ],
    );

    $ownerRole = Role::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('code', 'organisation_owner')
        ->firstOrFail();

    MembershipRole::withoutTenancy()->updateOrCreate(
        ['membership_id' => $membership->getKey(), 'role_id' => $ownerRole->getKey()],
        ['organisation_id' => $cedarId, 'created_by' => $userId],
    );
});

$tenantContext->during($userId, $platformId, null, function () use ($userId, $platformId): void {
    $platformMembership = OrganisationMembership::withoutTenancy()->updateOrCreate(
        ['organisation_id' => $platformId, 'user_id' => $userId],
        [
            'status' => MembershipStatus::Active,
            'joined_at' => now(),
            'created_by' => $userId,
        ],
    );

    $superRole = Role::withoutTenancy()->updateOrCreate(
        ['organisation_id' => $platformId, 'code' => 'super_admin'],
        [
            'name_en' => 'Super administrator',
            'name_ar' => 'المشرف الأعلى',
            'is_system' => false,
            'created_by' => $userId,
        ],
    );

    $platformCodes = array_keys(PermissionRegistry::platformPermissions());
    $permissionIds = Permission::query()->whereIn('code', $platformCodes)->pluck('id', 'code');

    foreach ($platformCodes as $code) {
        if (! isset($permissionIds[$code])) {
            fwrite(STDERR, "Permission not yet seeded: {$code}\n");

            continue;
        }

        RolePermission::withoutTenancy()->updateOrCreate(
            ['role_id' => $superRole->getKey(), 'permission_id' => $permissionIds[$code]],
            ['organisation_id' => $platformId],
        );
    }

    MembershipRole::withoutTenancy()->updateOrCreate(
        ['membership_id' => $platformMembership->getKey(), 'role_id' => $superRole->getKey()],
        ['organisation_id' => $platformId, 'created_by' => $userId],
    );

    $referenceEditor = Role::withoutTenancy()
        ->where('organisation_id', $platformId)
        ->where('code', 'reference_editor')
        ->first();

    if ($referenceEditor !== null) {
        MembershipRole::withoutTenancy()->updateOrCreate(
            ['membership_id' => $platformMembership->getKey(), 'role_id' => $referenceEditor->getKey()],
            ['organisation_id' => $platformId, 'created_by' => $userId],
        );
    }
});

echo "Super admin created.\n";
echo "Email: {$email}\n";
echo "Password: {$password}\n";
echo 'Cedar Clinic (cedar-clinic): organisation_owner — all tenant permissions'."\n";
echo 'Healthy360 Operations (healthy360-operations): super_admin + reference_editor — all platform permissions'."\n";
echo 'Registry tenant permissions: '.count(array_keys(PermissionRegistry::organisationPermissions()))."\n";
echo 'Registry platform permissions: '.count(array_keys(PermissionRegistry::platformPermissions()))."\n";
