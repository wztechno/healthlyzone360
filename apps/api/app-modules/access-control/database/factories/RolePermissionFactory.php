<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Database\Factories;

use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<RolePermission>
 */
class RolePermissionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'role_id' => Role::factory(),
            'organisation_id' => fn (array $attributes): ?string => Role::withoutTenancy()
                ->whereKey($attributes['role_id'])
                ->value('organisation_id'),
            'permission_id' => Permission::factory(),
        ];
    }
}
