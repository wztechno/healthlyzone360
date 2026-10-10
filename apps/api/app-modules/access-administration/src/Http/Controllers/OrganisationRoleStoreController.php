<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use Healthy360\AccessAdministration\Http\Concerns\ResolvesActorAuthority;
use Healthy360\AccessAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\AccessAdministration\Http\Requests\StoreOrganisationRoleRequest;
use Healthy360\AccessAdministration\Presenters\OrganisationRolePresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessAdministration\Services\RoleWriter;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * POST /api/v1/organisations/{organisation}/roles — define a role of this
 * kitchen's own.
 *
 * ## No `idempotency`, unlike the platform console's create
 *
 * PA1 puts an idempotency key on creating a kitchen because a tenant has no
 * natural key: a retry whose response was lost produces a second organisation,
 * and whoever goes looking finds two. A role has a natural key —
 * `roles_organisation_id_code_unique NULLS NOT DISTINCT (organisation_id, code)`
 * — so a replayed create hits the index and comes back as a `resource.conflict`
 * naming the field. Adding idempotency here would be machinery for a race the
 * database already settles, and settles with a better message.
 *
 * ## `Gate::authorize('create')` on top of the route's middleware
 *
 * The middleware has already established the caller holds
 * `role.manage_organisation`. The Gate call routes the same question through
 * `RolePolicy`, which is where the platform's explicit prohibitions live — and
 * AA1 is the first phase in which that policy is invoked from HTTP at all. It
 * matters more on the sibling endpoints (a template refuses `update` there),
 * but a create path that skipped the policy would be the one door left open
 * when a condition is added to it.
 *
 * ## Shadowing a template is reported, not refused
 *
 * A kitchen may define `kitchen_manager` for itself, and
 * `MembershipGranter::role()` documents preferring a tenant's own role over the
 * platform template of the same code. That is the supported way to change what
 * a template means inside one kitchen, so refusing it would break documented
 * behaviour. `meta.shadows_template` is how the console warns instead — because
 * a kitchen that did it deliberately and a kitchen that did it by accident type
 * exactly the same thing.
 */
final class OrganisationRoleStoreController
{
    use ResolvesActorAuthority;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly AccessAdministrationQuery $query,
        private readonly RoleWriter $writer,
        private readonly OrganisationRolePresenter $presenter,
        private readonly PermissionChecker $checker,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreOrganisationRoleRequest $request, string $organisation): JsonResponse
    {
        $tenant = $this->locator->contextOrganisation($organisation);

        Gate::authorize('create', Role::class);

        $actor = $this->currentUser($request);

        $role = $this->writer->create(
            $tenant,
            $request->payload(),
            $actor,
            $this->actorCodes($actor, $this->tenant, $this->checker),
        );

        $codes = $this->query->codesForRole((string) $role->getKey());

        return ApiResponse::data(
            ['role' => $this->presenter->detail($role, 0, $codes, null)],
            ['shadows_template' => $this->query->shadowsTemplate((string) $tenant->getKey(), (string) $role->code)],
            status: 201,
        )->header('ETag', '"'.(int) $role->lock_version.'"');
    }
}
