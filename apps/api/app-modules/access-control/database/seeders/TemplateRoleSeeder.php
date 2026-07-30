<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Database\Seeders;

use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Platform template roles: organisation_id NULL, is_system true, visible in
 * every tenant context and not editable from inside a tenant (RolePolicy).
 * Organisations assign them directly through membership_roles until bespoke
 * per-organisation roles are needed.
 *
 * Grants are reconciled, not merely added: a permission removed from the
 * registry is removed from the template on the next run.
 *
 * Depends on PermissionSeeder.
 */
class TemplateRoleSeeder extends Seeder
{
    public function run(): void
    {
        /** @var array<string, string> $permissionIdsByCode */
        $permissionIdsByCode = Permission::query()->pluck('id', 'code')->all();

        foreach (PermissionRegistry::templateRoles() as $code => $template) {
            $role = Role::withoutTenancy()->updateOrCreate(
                ['organisation_id' => null, 'code' => $code],
                [
                    'name_en' => $template['name_en'],
                    'name_ar' => $template['name_ar'],
                    'is_system' => true,
                ],
            );

            $permissionIds = [];

            foreach ($template['permissions'] as $permissionCode) {
                if (! isset($permissionIdsByCode[$permissionCode])) {
                    throw new RuntimeException(
                        "Template role [{$code}] references unseeded permission [{$permissionCode}]."
                    );
                }

                $permissionId = $permissionIdsByCode[$permissionCode];
                $permissionIds[] = $permissionId;

                RolePermission::withoutTenancy()->updateOrCreate(
                    ['role_id' => $role->getKey(), 'permission_id' => $permissionId],
                    ['organisation_id' => null],
                );
            }

            $stale = RolePermission::withoutTenancy()
                ->where('role_id', $role->getKey())
                ->whereNotIn('permission_id', $permissionIds)
                ->get();

            foreach ($stale as $grant) {
                $grant->delete();
            }
        }
    }
}
