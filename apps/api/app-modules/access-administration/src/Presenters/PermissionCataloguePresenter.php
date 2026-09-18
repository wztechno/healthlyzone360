<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Presenters;

use Healthy360\AccessControl\Models\Permission;
use Illuminate\Support\Collection;

/**
 * The vocabulary a role is written in, as the role editor reads it.
 *
 * ## Organisation codes only, and that is a security property rather than a
 * filter
 *
 * `PermissionRegistry` is split in two so that no organisation role can ever
 * acquire a platform code by construction, and `TemplateRoleSeeder` builds
 * every template from `organisationPermissions()` alone. This endpoint is the
 * same rule expressed one layer out: a catalogue that listed
 * `b2b_offboarding.waive_settlement_platform` would be a form offering a
 * checkbox the server is obliged to refuse, and the person who ticked it would
 * rightly read the refusal as a bug. What cannot be granted is not shown.
 *
 * `is_assignable` is filtered for the neighbouring reason —
 * `PermissionChecker::calculatedPermissions()` drops those codes when it
 * computes what somebody may do, so granting one produces a role that appears
 * to carry an authority and does not.
 *
 * ## Grouped by domain, because that is how a person reads it
 *
 * The Advanced tab is a long list, and `domain` is the only grouping the
 * backend already has an opinion about — it is a column on `permissions`, seeded
 * from the registry. Grouping client-side from the code's own prefix would be
 * the same grouping derived twice, and would drift the first time a domain and
 * a prefix disagreed.
 *
 * ## `held_by_caller`, and why it is here at all
 *
 * AA1 ships with no privilege-escalation guard: whoever holds
 * `role.manage_organisation` may grant any organisation-scoped code, including
 * ones they do not hold themselves. That was a deliberate call, and this field
 * is what keeps it an informed one — the editor marks a code the administrator
 * does not hold rather than hiding or disabling it, so granting an authority
 * you cannot exercise stays possible and stops being accidental.
 *
 * It is also the affordance a guard would need if the decision is ever
 * revisited, which is the cheap half of leaving that door open.
 */
final class PermissionCataloguePresenter
{
    /**
     * @param  Collection<int, Permission>  $permissions
     * @param  list<string>  $callerCodes
     * @return list<array{domain: string, permissions: list<array{code: string, description: string, held_by_caller: bool}>}>
     */
    public function catalogue(Collection $permissions, array $callerCodes): array
    {
        $held = array_flip($callerCodes);

        return array_values($permissions
            ->sortBy('code')
            ->groupBy('domain')
            ->map(static fn (Collection $group, string $domain): array => [
                'domain' => $domain,
                // `all()` hands back a keyed array whatever `values()` did to the collection, so
                // `array_values()` is what states these are the lists the signature promises.
                'permissions' => array_values(
                    $group
                        ->map(static fn (Permission $permission): array => [
                            'code' => (string) $permission->code,
                            'description' => (string) $permission->description,
                            'held_by_caller' => isset($held[(string) $permission->code]),
                        ])
                        ->all(),
                ),
            ])
            ->sortKeys()
            ->values()
            ->all());
    }
}
