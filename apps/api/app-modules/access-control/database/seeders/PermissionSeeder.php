<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Database\Seeders;

use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Illuminate\Database\Seeder;

/**
 * Writes the foundation permission catalogue held in PermissionRegistry.
 * Kitchen and commercial permissions stay registry proposals until those
 * modules exist (plan §10), so nothing outside the registry is seeded.
 */
class PermissionSeeder extends Seeder
{
    public function run(): void
    {
        foreach (PermissionRegistry::foundationPermissions() as $code => $definition) {
            Permission::query()->updateOrCreate(
                ['code' => $code],
                [
                    'domain' => $definition['domain'],
                    'description' => $definition['description'],
                    'is_assignable' => true,
                ],
            );
        }
    }
}
