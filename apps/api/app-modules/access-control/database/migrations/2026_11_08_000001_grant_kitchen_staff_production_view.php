<?php

declare(strict_types=1);

use Healthy360\AccessControl\Services\PermissionCache;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The cook reads batches: `production.view_organisation` reaches every seeded
 * `kitchen_staff` copy on a deployed database (owner, 8 Nov 2026), so a line cook
 * can open the batch they are cooking and record its core temperature. The
 * permission row already exists; only the grant is new. Shape as
 * `2026_11_03_020202`.
 */
return new class extends Migration
{
    private const string PERMISSION = 'production.view_organisation';

    /**
     * A binding rather than inline SQL, because PDO would read the `?` as a
     * placeholder.
     */
    private const string COPY_OF_A_COOK = '^kitchen_staff(_standard(_[0-9]+)?)?$';

    public function up(): void
    {
        $granted = DB::affectingStatement(
            'INSERT INTO role_permissions (id, organisation_id, role_id, permission_id, created_by, created_at)
             SELECT gen_random_uuid(), roles.organisation_id, roles.id, permissions.id, NULL, now()
             FROM roles
             JOIN permissions ON permissions.code = ?
             WHERE roles.code ~ ?
               AND roles.created_by IS NULL
             ON CONFLICT (role_id, permission_id) DO NOTHING',
            [self::PERMISSION, self::COPY_OF_A_COOK],
        );

        if ($granted > 0) {
            app(PermissionCache::class)->bumpVersion(null);
        }
    }

    /**
     * Only the cook's grants go. The permission row predates this migration and
     * other roles hold it.
     */
    public function down(): void
    {
        $removed = DB::affectingStatement(
            'DELETE FROM role_permissions
             USING roles, permissions
             WHERE role_permissions.role_id = roles.id
               AND role_permissions.permission_id = permissions.id
               AND permissions.code = ?
               AND roles.code ~ ?
               AND roles.created_by IS NULL',
            [self::PERMISSION, self::COPY_OF_A_COOK],
        );

        if ($removed > 0) {
            app(PermissionCache::class)->bumpVersion(null);
        }
    }
};
