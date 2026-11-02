<?php

declare(strict_types=1);

use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The template roles become the jobs the owner named, on every database.
 *
 * A deploy only migrates and nothing re-syncs a copy, so everything
 * `PermissionRegistry` says about roles for real jobs is repeated here, as
 * `2026_11_02_000103` did for one code. Four things, and every one of them adds:
 *
 * - **`order.prepare_organisation`**, the kitchen display's own code, inserted and
 *   granted to its holders.
 * - **`branch_manager`** gains the order book, the desk, supervision and the reads
 *   those screens stand on. That is the fix for a manager refused the display.
 * - **`kitchen_driver`**, a new template with a copy in every organisation.
 * - **Plain names and descriptions.** A name moves only where it still reads the
 *   old template name and a description lands only where there is none, so a
 *   kitchen that renamed a role keeps its wording.
 *
 * **Nobody loses anything.** No grant is removed, no assignment is moved and no
 * role is deleted. The retired templates are hidden from the role list by
 * `PermissionRegistry::isHiddenRole()`, in code, which needs no row changed here.
 *
 * A copy is told apart as `2026_11_02_000103` tells it: the template's code or
 * `<code>_standard` with a number, and an empty `created_by`, so a role a kitchen
 * made itself keeps exactly what the kitchen gave it. The same gap applies: a role
 * whose author's `users` row was deleted by hand looks like a copy.
 *
 * Idempotent, and quiet on a fresh database: the permission row is written, the
 * template inserts select nothing because there are no templates to copy from,
 * and the seeders then write the same rows. Raw SQL as the migration owner (RLS
 * is enabled, not forced).
 */
return new class extends Migration
{
    private const string PERMISSION = 'order.prepare_organisation';

    /** Who gains what. Each role's copies gain it too. */
    private const array GRANTS = [
        'organisation_owner' => [self::PERMISSION],
        'organisation_admin' => [self::PERMISSION],
        'kitchen_manager' => [self::PERMISSION],
        'kitchen_chef' => [self::PERMISSION],
        'kitchen_staff' => [self::PERMISSION],
        'branch_manager' => [
            self::PERMISSION,
            'organisation.view_current',
            'order.view_organisation',
            'order.manage_organisation',
            'order.supervise_organisation',
            'order.view_customer_contact_organisation',
            'order.create_on_behalf_organisation',
            'customer.create_on_behalf_organisation',
            'catalogue.view_organisation',
            'inventory.view_organisation',
            'production.view_organisation',
        ],
    ];

    /** The name each template carried before, which marks a copy nobody renamed. */
    private const array OLD_NAMES = [
        'organisation_owner' => 'Organisation owner',
        'kitchen_manager' => 'Kitchen manager',
        'kitchen_staff' => 'Kitchen staff',
        'procurement_manager' => 'Purchasing manager',
        'finance_manager' => 'Finance manager',
        'order_desk_agent' => 'Order desk agent',
    ];

    private const string DRIVER = 'kitchen_driver';

    public function up(): void
    {
        DB::statement(
            'INSERT INTO permissions (id, code, domain, description, is_assignable, created_at, updated_at)
             VALUES (gen_random_uuid(), ?, ?, ?, true, now(), now())
             ON CONFLICT (code) DO NOTHING',
            [self::PERMISSION, 'order', 'Read the kitchen display, start cooking and mark orders ready'],
        );

        $templates = PermissionRegistry::templateRoles();
        $changed = $this->addDriverTemplate($templates[self::DRIVER]);
        $changed += $this->copyDriverIntoEveryOrganisation();

        foreach (self::GRANTS as $code => $permissions) {
            foreach ($permissions as $permission) {
                $changed += DB::affectingStatement(
                    'INSERT INTO role_permissions (id, organisation_id, role_id, permission_id, created_by, created_at)
                     SELECT gen_random_uuid(), roles.organisation_id, roles.id, permissions.id, NULL, now()
                     FROM roles
                     JOIN permissions ON permissions.code = ?
                     WHERE roles.code ~ ?
                       AND roles.created_by IS NULL
                     ON CONFLICT (role_id, permission_id) DO NOTHING',
                    [$permission, '^'.$code.'(_standard(_[0-9]+)?)?$'],
                );
            }
        }

        foreach ($templates as $code => $template) {
            $this->describe($code, $template);
        }

        DB::update(
            'UPDATE roles SET name_en = ?, name_ar = ?, description_en = COALESCE(description_en, ?), description_ar = COALESCE(description_ar, ?), updated_at = now()
             WHERE code = ? AND name_en = ?',
            [
                'Platform super admin',
                'المشرف العام للمنصة',
                'Runs the platform for every kitchen: opens and suspends kitchens, and keeps the shared reference data.',
                'يدير المنصة لكل المطابخ: يفتح المطابخ ويعلّقها، ويحافظ على البيانات المرجعية المشتركة.',
                'reference_editor',
                'Reference editor',
            ],
        );

        if ($changed > 0) {
            app(PermissionCache::class)->bumpVersion(null);
        }
    }

    /**
     * The driver template, only where templates exist: a fresh database has none
     * yet and `TemplateRoleSeeder` writes it with the others.
     *
     * @param  array{name_en: string, name_ar: string, description_en: string, description_ar: string, permissions: list<string>}  $template
     */
    private function addDriverTemplate(array $template): int
    {
        if (! DB::table('roles')->whereNull('organisation_id')->exists()) {
            return 0;
        }

        $inserted = DB::affectingStatement(
            'INSERT INTO roles (id, organisation_id, code, name_en, name_ar, description_en, description_ar, is_system, lock_version, created_at, updated_at)
             SELECT gen_random_uuid(), NULL, ?, ?, ?, ?, ?, true, 0, now(), now()
             WHERE NOT EXISTS (SELECT 1 FROM roles WHERE organisation_id IS NULL AND code = ?)',
            [self::DRIVER, $template['name_en'], $template['name_ar'], $template['description_en'], $template['description_ar'], self::DRIVER],
        );

        foreach ($template['permissions'] as $permission) {
            DB::statement(
                'INSERT INTO role_permissions (id, organisation_id, role_id, permission_id, created_by, created_at)
                 SELECT gen_random_uuid(), NULL, roles.id, permissions.id, NULL, now()
                 FROM roles
                 JOIN permissions ON permissions.code = ?
                 WHERE roles.organisation_id IS NULL AND roles.code = ?
                 ON CONFLICT (role_id, permission_id) DO NOTHING',
                [$permission, self::DRIVER],
            );
        }

        return $inserted;
    }

    /**
     * What `OrganisationRoles::provision()` would have stamped. An organisation
     * that already uses the code keeps its own role.
     */
    private function copyDriverIntoEveryOrganisation(): int
    {
        $copied = DB::affectingStatement(
            'INSERT INTO roles (id, organisation_id, code, name_en, name_ar, description_en, description_ar, is_system, lock_version, created_at, updated_at)
             SELECT gen_random_uuid(), organisations.id, template.code, template.name_en, template.name_ar, template.description_en, template.description_ar, false, 0, now(), now()
             FROM organisations
             JOIN roles template ON template.organisation_id IS NULL AND template.code = ?
             ON CONFLICT (organisation_id, code) DO NOTHING',
            [self::DRIVER],
        );

        DB::statement(
            'INSERT INTO role_permissions (id, organisation_id, role_id, permission_id, created_by, created_at)
             SELECT gen_random_uuid(), copy.organisation_id, copy.id, grants.permission_id, NULL, now()
             FROM roles copy
             JOIN roles template ON template.organisation_id IS NULL AND template.code = copy.code
             JOIN role_permissions grants ON grants.role_id = template.id
             WHERE copy.organisation_id IS NOT NULL AND copy.code = ? AND copy.created_by IS NULL
             ON CONFLICT (role_id, permission_id) DO NOTHING',
            [self::DRIVER],
        );

        return $copied;
    }

    /**
     * @param  array{name_en: string, name_ar: string, description_en: string, description_ar: string, permissions: list<string>}  $template
     */
    private function describe(string $code, array $template): void
    {
        $roles = DB::table('roles')->where('code', $code)->whereNull('created_by');

        if (isset(self::OLD_NAMES[$code])) {
            (clone $roles)->where('name_en', self::OLD_NAMES[$code])->update([
                'name_en' => $template['name_en'],
                'name_ar' => $template['name_ar'],
            ]);
        }

        (clone $roles)->whereNull('description_en')->update(['description_en' => $template['description_en']]);
        (clone $roles)->whereNull('description_ar')->update(['description_ar' => $template['description_ar']]);
    }

    /**
     * The permission row and its grants go; the driver roles go only where
     * nobody holds them. Names and descriptions stay: they are wording, and a
     * kitchen may have edited them since.
     */
    public function down(): void
    {
        DB::table('permissions')->where('code', self::PERMISSION)->delete();

        DB::table('roles')
            ->where('code', self::DRIVER)
            ->whereNull('created_by')
            ->whereNotIn('id', DB::table('membership_roles')->select('role_id'))
            ->delete();

        app(PermissionCache::class)->bumpVersion(null);
    }
};
