<?php

declare(strict_types=1);

use Healthy360\AccessControl\Services\PermissionCache;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The purchasing manager reads the recipe book.
 *
 * The kitchen's meal, sauce, dressing and frozen-meal lists merged into one
 * recipe book, which sits behind `recipe.view_organisation`. The
 * `procurement_manager` template read those four lists under
 * `catalogue.view_organisation` and held no recipe code, so the merge would
 * have taken four pages away from every buyer. `PermissionRegistry` now grants
 * it, and `TemplateRoleSeeder` reconciles the registry on every seed — which
 * covers a fresh install, `scripts/reset.*` and the droplet rebuild, all of
 * which seed.
 *
 * **A deploy never seeds** (`infrastructure/deploy/deploy.sh`), so a database
 * that already exists gets the grant here. Only the platform template row — the
 * role with no organisation, which kitchens assign directly — and the grant is
 * written as the seeder writes it, with no organisation. A kitchen's own
 * bespoke roles are the kitchen's to change in the role editor.
 *
 * Idempotent, and quiet on a database that has not been seeded yet: the insert
 * selects the role and the permission it needs and conflicts on
 * `(role_id, permission_id)`, so a missing template, a missing permission or a
 * grant already in place all write nothing. Raw SQL rather than the models, so
 * the migration keeps meaning what it says when the models move on.
 *
 * Every writer of a grant bumps the platform permission version so that no
 * signed-in buyer waits out the cache's five minutes (`PermissionVersionObserver`
 * does it for model writes); this does it by hand, and only when a row moved.
 */
return new class extends Migration
{
    private const string ROLE = 'procurement_manager';

    private const string PERMISSION = 'recipe.view_organisation';

    public function up(): void
    {
        $granted = DB::affectingStatement(
            'INSERT INTO role_permissions (id, organisation_id, role_id, permission_id, created_by, created_at)
             SELECT gen_random_uuid(), NULL, roles.id, permissions.id, NULL, now()
             FROM roles
             JOIN permissions ON permissions.code = ?
             WHERE roles.organisation_id IS NULL
               AND roles.code = ?
             ON CONFLICT (role_id, permission_id) DO NOTHING',
            [self::PERMISSION, self::ROLE],
        );

        if ($granted > 0) {
            app(PermissionCache::class)->bumpVersion(null);
        }
    }

    public function down(): void
    {
        $revoked = DB::affectingStatement(
            'DELETE FROM role_permissions
             USING roles, permissions
             WHERE role_permissions.role_id = roles.id
               AND role_permissions.permission_id = permissions.id
               AND roles.organisation_id IS NULL
               AND roles.code = ?
               AND permissions.code = ?',
            [self::ROLE, self::PERMISSION],
        );

        if ($revoked > 0) {
            app(PermissionCache::class)->bumpVersion(null);
        }
    }
};
