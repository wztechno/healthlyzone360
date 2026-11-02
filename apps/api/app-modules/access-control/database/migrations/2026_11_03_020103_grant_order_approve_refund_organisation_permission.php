<?php

declare(strict_types=1);

use Healthy360\AccessControl\Services\PermissionCache;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `order.approve_refund_organisation` reaches a deployed database. The owner
 * alone holds it. `2026_11_02_000103` gives the reasoning for the shape.
 */
return new class extends Migration
{
    private const string PERMISSION = 'order.approve_refund_organisation';

    /**
     * A binding rather than inline SQL, because PDO would read the `?` as a
     * placeholder.
     */
    private const string COPY_OF_A_HOLDER = '^organisation_owner(_standard(_[0-9]+)?)?$';

    public function up(): void
    {
        DB::statement(
            'INSERT INTO permissions (id, code, domain, description, is_assignable, created_at, updated_at)
             VALUES (gen_random_uuid(), ?, ?, ?, true, now(), now())
             ON CONFLICT (code) DO NOTHING',
            [self::PERMISSION, 'order', "Approve or reject a refund above the kitchen's limit"],
        );

        $granted = DB::affectingStatement(
            'INSERT INTO role_permissions (id, organisation_id, role_id, permission_id, created_by, created_at)
             SELECT gen_random_uuid(), roles.organisation_id, roles.id, permissions.id, NULL, now()
             FROM roles
             JOIN permissions ON permissions.code = ?
             WHERE roles.code ~ ?
               AND roles.created_by IS NULL
             ON CONFLICT (role_id, permission_id) DO NOTHING',
            [self::PERMISSION, self::COPY_OF_A_HOLDER],
        );

        if ($granted > 0) {
            app(PermissionCache::class)->bumpVersion(null);
        }
    }

    /**
     * The grants go with the permission row: `role_permissions.permission_id`
     * cascades.
     */
    public function down(): void
    {
        $removed = DB::table('permissions')->where('code', self::PERMISSION)->delete();

        if ($removed > 0) {
            app(PermissionCache::class)->bumpVersion(null);
        }
    }
};
