<?php

declare(strict_types=1);

use Healthy360\AccessControl\Services\PermissionCache;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `order.supervise_organisation` reaches every database, not only a freshly
 * seeded one.
 *
 * `PermissionRegistry` declares the code and the seeders write it, but a deploy
 * only migrates (`infrastructure/deploy/deploy.sh`), and nothing ever re-syncs an
 * organisation's copy of a role (`OrganisationRoles`). So this is the first
 * migration to insert a `permissions` row: without it a deployed kitchen would
 * have a code nobody holds.
 *
 * It grants the code to the three holders, on the templates and on every
 * organisation's copy of them. A copy is told apart by two things:
 *
 * - **Its code.** Either the template's, or `<code>_standard` with an optional
 *   number, which is what `2026_10_26_000001` calls the copy it makes when a
 *   kitchen already held the plain code. Those holders moved off the template
 *   and would otherwise miss a grant it gained.
 * - **An empty `created_by`.** A kitchen's own role can share either form of
 *   code, and `roles` has no column that says "copy". `created_by` is the signal:
 *   `RoleWriter` is the only path a kitchen creates a role through and it always
 *   stamps the actor, while `OrganisationRoles` and that migration never do. So a
 *   kitchen's own `kitchen_manager` keeps exactly what the kitchen gave it.
 *
 * One gap remains: `roles.created_by` is `nullOnDelete`, so a kitchen's role whose
 * author's `users` row was deleted by hand looks like a copy. The application
 * itself never deletes a user. A role a kitchen deleted stays deleted.
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
    private const string PERMISSION = 'order.supervise_organisation';

    /**
     * A binding rather than inline SQL, because PDO would read the `?` as a
     * placeholder.
     */
    private const string COPY_OF_A_HOLDER = '^(organisation_owner|organisation_admin|kitchen_manager)(_standard(_[0-9]+)?)?$';

    public function up(): void
    {
        DB::statement(
            'INSERT INTO permissions (id, code, domain, description, is_assignable, created_at, updated_at)
             VALUES (gen_random_uuid(), ?, ?, ?, true, now(), now())
             ON CONFLICT (code) DO NOTHING',
            [self::PERMISSION, 'order', 'Cancel orders once cooking has started and receive order alerts'],
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
