<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Presenters;

use Healthy360\AccessControl\Models\Role;

/**
 * The wire shape of a role.
 *
 * Two methods rather than one with a flag, the rule this platform writes
 * everywhere: `summary()` is a list row and `detail()` carries the grant set.
 * A boolean between them is one wrong argument away from a list endpoint
 * serving every permission of every role in the organisation.
 *
 * ## `is_system` is the field the console branches on, and it is not decoration
 *
 * A template role is visible in every tenant — `Role::organisationScopeAllowsNull()`
 * is true — and editable in none: `RolePolicy::additionalConditions` refuses it,
 * and the `roles` RLS policy refuses the UPDATE independently because a null
 * `organisation_id` can never match an organisation. So the console offers
 * **Copy** on these rows and never Edit, and this flag is how it knows which is
 * which. Serving it as `is_system` rather than as a computed `editable` is
 * deliberate: `editable` would be a server-side guess about a permission the
 * client already knows it holds, and it would be wrong for a reader.
 *
 * ## `holder_count` on the summary, and the whole grant set only on the detail
 *
 * How many people hold a role is the fact that makes a list actionable — it is
 * what says which roles are real and which were defined and forgotten, and it
 * is the number that decides whether deletion will be refused. The grant set
 * is not: eleven roles by forty-three codes is a list nobody reads, and it is
 * the detail endpoint's whole job.
 */
final class OrganisationRolePresenter
{
    /**
     * @param  list<string>  $permissionCodes
     * @return array<string, mixed>
     */
    public function summary(Role $role, int $holderCount, int $permissionCount): array
    {
        return [
            'id' => (string) $role->getKey(),
            'code' => (string) $role->code,
            'name_en' => (string) $role->name_en,
            'name_ar' => (string) $role->name_ar,
            'description_en' => $role->description_en === null ? null : (string) $role->description_en,
            'description_ar' => $role->description_ar === null ? null : (string) $role->description_ar,
            'is_system' => (bool) $role->is_system,
            'holder_count' => $holderCount,
            'permission_count' => $permissionCount,
            // A template has no lock version to speak of — it is never written
            // from here — but the field is present and zero rather than absent,
            // so a client can type one shape for both kinds of row.
            'lock_version' => (int) ($role->lock_version ?? 0),
            'updated_at' => $role->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @param  list<string>  $permissionCodes
     * @return array<string, mixed>
     */
    public function detail(Role $role, int $holderCount, array $permissionCodes, ?string $updatedByName): array
    {
        return [
            ...$this->summary($role, $holderCount, count($permissionCodes)),
            'permissions' => $permissionCodes,
            // Who last changed what this role may reach — the one question an
            // access review asks that `created_by` cannot answer. Null on a
            // template, and on a role nobody has edited since AA1 added the
            // column.
            'updated_by_name' => $updatedByName,
        ];
    }
}
