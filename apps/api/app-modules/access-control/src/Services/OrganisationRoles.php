<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Services;

use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Support\Identifiers\IdentifierService;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Every organisation owns its roles; the platform templates are blueprints.
 *
 * The rows with `organisation_id NULL` used to be assigned directly, one row
 * shared by every kitchen, which is why nobody could edit them. They now only
 * stamp out copies: a new organisation gets its own row for each template, with
 * the template's grants, and from then on the copy is the kitchen's to rename,
 * re-grant or delete in the role editor.
 *
 * **Nothing re-syncs a copy.** `TemplateRoleSeeder` reconciles the templates,
 * never the copies. A default grant that must reach existing kitchens ships as
 * a data migration that only adds it to each organisation's role of that code;
 * a role a kitchen deleted stays deleted, because `provision()` runs when an
 * organisation is created and never again.
 *
 * **The database context is set, not just the Eloquent scope lifted.** The RLS
 * policies on `roles` and `role_permissions` check every insert against
 * `app.organisation_id`, and the callers (kitchen provisioning, an approved
 * application, a seeder) run with no organisation in context. `during()` is the
 * bounded, auditable way to write as that organisation.
 */
final readonly class OrganisationRoles
{
    public function __construct(
        private DatabaseTenantContext $database,
        private IdentifierService $identifiers,
        private PermissionCache $cache,
    ) {}

    /**
     * Copy each template the organisation has no role of the same code for.
     * Idempotent: a second run finds every code taken and writes nothing.
     */
    public function provision(string $organisationId): void
    {
        $created = $this->database->during(null, $organisationId, null, fn (): int => DB::transaction(function () use ($organisationId): int {
            $owned = Role::withoutTenancy()->where('organisation_id', $organisationId)->pluck('code')->all();

            $templates = Role::withoutTenancy()
                ->whereNull('organisation_id')
                ->whereNotIn('code', $owned)
                ->orderBy('code')
                ->get();

            if ($templates->isEmpty()) {
                return 0;
            }

            $grants = RolePermission::withoutTenancy()
                ->whereIn('role_id', $templates->modelKeys())
                ->get(['role_id', 'permission_id'])
                ->groupBy('role_id');

            foreach ($templates as $template) {
                $copy = Role::withoutTenancy()->create([
                    'organisation_id' => $organisationId,
                    'code' => $template->code,
                    'name_en' => $template->name_en,
                    'name_ar' => $template->name_ar,
                    'description_en' => $template->description_en,
                    'description_ar' => $template->description_ar,
                    'is_system' => false,
                    'lock_version' => 0,
                ]);

                $rows = ($grants[$template->getKey()] ?? collect())->map(fn (RolePermission $grant): array => [
                    'id' => $this->identifiers->generate(),
                    'organisation_id' => $organisationId,
                    'role_id' => $copy->getKey(),
                    'permission_id' => $grant->permission_id,
                    'created_at' => now(),
                ])->all();

                if ($rows !== []) {
                    RolePermission::withoutTenancy()->insert($rows);
                }
            }

            return $templates->count();
        }));

        if ($created > 0) {
            $this->cache->bumpVersion($organisationId);
        }
    }
}
