<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use Healthy360\AccessAdministration\Presenters\OrganisationRolePresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/organisations/{organisation}/roles — the roles this kitchen can
 * assign.
 *
 * **Templates and bespoke roles come back in one list**, distinguished by
 * `is_system`, and that is the shape the console needs rather than a
 * convenience. The two are genuinely one set from the assigning side: when an
 * administrator picks a role for somebody, a platform template and the
 * kitchen's own are equally valid choices, and an endpoint that served them
 * separately would make the one screen that matters do a join the server had
 * already done. The roles *list* draws them as two sections because they are
 * edited differently; the member editor draws them as one picker because they
 * are assigned identically.
 *
 * They arrive together without a `whereNull`/`orWhere` because
 * `Role::organisationScopeAllowsNull()` is already true: the tenant scope
 * admits a null `organisation_id`, which is exactly what makes a template
 * visible in every tenant. Writing the predicate by hand here would restate
 * the model's own rule in a second place and eventually disagree with it.
 *
 * Templates first, then the kitchen's own by code. A person scanning this list
 * is usually looking for the standard role, and the bespoke ones are the
 * exceptions worth reading after it.
 *
 * ## Unpaginated
 *
 * Eleven templates plus however many a kitchen has defined, and every one of
 * them is a row in a picker that has to be complete to be usable. A cursor
 * would mean an editor that cannot draw its own dropdown without draining one.
 */
final class OrganisationRoleIndexController
{
    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly AccessAdministrationQuery $query,
        private readonly OrganisationRolePresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $organisation): JsonResponse
    {
        $this->locator->contextOrganisation($organisation);

        $roles = Role::query()
            ->orderByRaw('organisation_id IS NOT NULL')
            ->orderBy('code')
            ->get();

        $roleIds = array_values(
            $roles->map(static fn (Role $role): string => (string) $role->getKey())->all(),
        );

        $holders = $this->query->holderCountsFor($roleIds);
        $grants = $this->query->codesForRoles($roleIds);

        return ApiResponse::data(
            $roles->map(fn (Role $role): array => $this->presenter->summary(
                $role,
                $holders[(string) $role->getKey()] ?? 0,
                count($grants[(string) $role->getKey()] ?? []),
            ))->all(),
        );
    }
}
