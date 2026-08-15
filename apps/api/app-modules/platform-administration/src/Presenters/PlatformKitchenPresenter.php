<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Presenters;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;

/**
 * The wire shape of a kitchen organisation as the platform sees it.
 *
 * Two methods, not one with a flag. `summary()` is the queue row — enough to
 * scan a list and decide which kitchen to open — and `detail()` adds the
 * branches, the owner list and the suspension note. The rule this platform
 * writes everywhere applies here too: two shapes with a boolean between them
 * is one wrong argument away from returning a list of every owner's email
 * address on a screen that only wanted names.
 *
 * `OrganisationPresenter` is not reused. It answers "which organisation am I
 * signed into?" for the member who is signed into it, and its `capabilities`
 * field is that member's view of their own tenant. This answers "what has the
 * platform got here?" about somebody else's tenant, and the two will diverge —
 * this one will grow trading history and that one will not.
 */
final class PlatformKitchenPresenter
{
    /**
     * @param  array{
     *     branches: int,
     *     active_branches: int,
     *     owners: list<array{membership_id: string, user_id: string, name: string|null, email: string, status: string}>,
     *     catalogue: array{meals: int, products: int, plans: int, published: int, draft: int}
     * }  $overview
     * @return array<string, mixed>
     */
    public function summary(Organisation $organisation, array $overview): array
    {
        return [
            'id' => (string) $organisation->getKey(),
            'slug' => $organisation->slug,
            'name' => $organisation->name,
            'status' => $organisation->status->value,
            'country_code' => $organisation->country_code,
            'default_currency_code' => $organisation->default_currency_code,
            'default_language_code' => $organisation->default_language_code,
            'branch_count' => $overview['branches'],
            'active_branch_count' => $overview['active_branches'],
            'owner_count' => count($overview['owners']),
            'catalogue' => $overview['catalogue'],
            'suspended_at' => $organisation->suspended_at?->toIso8601String(),
            'lock_version' => $organisation->lock_version,
            'created_at' => $organisation->created_at?->toIso8601String(),
        ];
    }

    /**
     * @param  array{
     *     branches: int,
     *     active_branches: int,
     *     owners: list<array{membership_id: string, user_id: string, name: string|null, email: string, status: string}>,
     *     catalogue: array{meals: int, products: int, plans: int, published: int, draft: int}
     * }  $overview
     * @param  list<OrganisationBranch>  $branches
     * @return array<string, mixed>
     */
    public function detail(Organisation $organisation, array $overview, array $branches): array
    {
        return $this->summary($organisation, $overview) + [
            'suspension_reason' => $organisation->suspension_reason,
            'suspended_by' => $organisation->suspended_by,
            'owners' => $overview['owners'],
            'branches' => array_map(fn (OrganisationBranch $branch): array => $this->branch($branch), $branches),
        ];
    }

    /**
     * @return array{id: string, name: string, city: string|null, country_code: string, timezone: string, status: string}
     */
    public function branch(OrganisationBranch $branch): array
    {
        return [
            'id' => (string) $branch->getKey(),
            'name' => $branch->name,
            'city' => $branch->city,
            'country_code' => $branch->country_code,
            'timezone' => $branch->timezone,
            'status' => $branch->status->value,
        ];
    }
}
