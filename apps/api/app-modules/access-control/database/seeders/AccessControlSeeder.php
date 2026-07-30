<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Database\Seeders;

use Illuminate\Database\Seeder;

/**
 * Access-control module entry point: the permission catalogue first, then
 * the platform template roles that grant from it.
 */
class AccessControlSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            PermissionSeeder::class,
            TemplateRoleSeeder::class,
        ]);
    }
}
