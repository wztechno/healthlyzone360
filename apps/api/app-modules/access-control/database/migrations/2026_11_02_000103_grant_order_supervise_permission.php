<?php

declare(strict_types=1);

use Healthy360\AccessControl\Services\PermissionCache;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `order.supervise` reaches every database, not only a freshly seeded one.
 *
 * `PermissionRegistry` declares the code and the seeders write it, but a deploy
 * only migrates (`infrastructure/deploy/deploy.sh`), and nothing ever re-syncs an
 * organisation's copy of a role (`OrganisationRoles`). So this is the first
 * migration to insert a `permissions` row: without it a deployed kitchen would
 * have a code nobody holds.
 *
 * It grants the code to the three holders, on the templates and on every
 * organisation's role of that code, including a kitchen's `<code>_standard` copy
 * (`2026_10_26_000001`), whose holders were moved off the template and would
 * otherwise miss a grant the template gained. A role a kitchen deleted stays
 * deleted.
 *
 * Idempotent, and quiet on a fresh database, where migrations run before the
 * seeders: the permission row is written either way, the seeder then updates
 * that same row, and with no roles yet the grant selects nothing. Raw SQL, as the
 * migration owner (RLS is enabled, not forced), so the migration keeps meaning
 * what it says when the models move on.
 *
 * The platform counter is in every cache key, so one bump covers every kitchen.
 */
return new class extends Migration
{
    private const string PERMISSION = 'order.supervise';

    /**
     * @var list<string>
     */
    private const array ROLES = [
        'organisation_owner',
        'organisation_admin',
        'kitchen_manager',
        'organisation_owner_standard',
        'organisation_admin_standard',
        'kitchen_manager_standard',
    ];

    public function up(): void
    {
        DB::statement(
            'INSERT INTO permissions (id, code, domain, description, is_assignable, created_at, updated_at)
             VALUES (gen_random_uuid(), ?, ?, ?, true, now(), now())
             ON CONFLICT (code) DO NOTHING',
            [self::PERMISSION, 'order', 'Cancel orders once cooking has started and receive order alerts'],
        );

        $placeholders = implode(', ', array_fill(0, count(self::ROLES), '?'));

        $granted = DB::affectingStatement(
            "INSERT INTO role_permissions (id, organisation_id, role_id, permission_id, created_by, created_at)
             SELECT gen_random_uuid(), roles.organisation_id, roles.id, permissions.id, NULL, now()
             FROM roles
             JOIN permissions ON permissions.code = ?
             WHERE roles.code IN ({$placeholders})
             ON CONFLICT (role_id, permission_id) DO NOTHING",
            [self::PERMISSION, ...self::ROLES],
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
