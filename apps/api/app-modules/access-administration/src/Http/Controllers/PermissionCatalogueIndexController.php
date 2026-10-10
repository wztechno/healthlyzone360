<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use Healthy360\AccessAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\AccessAdministration\Presenters\PermissionCataloguePresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/organisations/{organisation}/permissions — the vocabulary a role
 * is written in.
 *
 * Gated on `role.view_organisation` rather than a code of its own: reading the
 * words a role can be written in is reading roles, and a separate
 * `permission.view_organisation` would be a code that no role could sensibly
 * hold without the one beside it.
 *
 * ## Two filters, and both of them are the security boundary rather than a
 * convenience
 *
 * The rows come from `permissions`, intersected with
 * `PermissionRegistry::organisationPermissions()` and narrowed to
 * `is_assignable`. The first keeps every platform code out of a form a tenant
 * fills in — the registry is split precisely so an organisation role cannot
 * acquire one, and an endpoint that offered the checkbox would be inviting a
 * 422 the person could not have predicted. The second matches
 * `PermissionChecker::calculatedPermissions()`, which drops non-assignable
 * codes when it computes what somebody may actually do; granting one would
 * produce a role that reads as carrying an authority and does not.
 *
 * Reading the registry rather than trusting a `domain` suffix is deliberate.
 * The suffix convention (`_platform`) is asserted by `PermissionRegistryTest`
 * and is true today, but it is a naming rule, and a naming rule is the wrong
 * thing to make a tenant boundary out of.
 *
 * ## Unpaginated, on purpose
 *
 * Forty-three codes, bounded by a constant in the source, read in full by one
 * screen that renders every one of them at once. A cursor here would be
 * machinery for a page that will never have a second page, and the editor would
 * have to drain it before it could render anything.
 */
final class PermissionCatalogueIndexController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly PermissionCataloguePresenter $presenter,
        private readonly PermissionChecker $checker,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $organisation): JsonResponse
    {
        $this->locator->contextOrganisation($organisation);

        $grantable = array_keys(PermissionRegistry::organisationPermissions());

        $permissions = Permission::query()
            ->whereIn('code', $grantable)
            ->where('is_assignable', true)
            ->get();

        return ApiResponse::data(
            ['domains' => $this->presenter->catalogue($permissions, $this->callerCodes($request))],
        );
    }

    /**
     * What the caller holds, so the editor can mark a code they are granting
     * but could not exercise themselves.
     *
     * Read through the checker rather than recomputed, because this is a
     * question about the present and the cache is the right answer to it. An
     * absent membership is not an error — `org.context` has already proved one
     * exists — but returning an empty list if it somehow were is the correct
     * failure: every code renders unmarked, and nothing is wrongly asserted
     * about the caller.
     *
     * @return list<string>
     *
     * @throws ApiException
     */
    private function callerCodes(Request $request): array
    {
        $membership = $this->tenant->membership();

        if ($membership === null) {
            return [];
        }

        return $this->checker->calculatedPermissions($this->currentUser($request), $membership, $this->tenant);
    }
}
