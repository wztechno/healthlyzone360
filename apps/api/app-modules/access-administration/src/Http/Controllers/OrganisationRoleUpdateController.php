<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use App\Models\User;
use Healthy360\AccessAdministration\Http\Concerns\ReadsPrecondition;
use Healthy360\AccessAdministration\Http\Concerns\ResolvesActorAuthority;
use Healthy360\AccessAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\AccessAdministration\Http\Requests\UpdateOrganisationRoleRequest;
use Healthy360\AccessAdministration\Presenters\OrganisationRolePresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessAdministration\Services\RoleWriter;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * PATCH /api/v1/organisations/{organisation}/roles/{role} — rename a role and
 * replace what it grants.
 *
 * ## Three refusals stack here, and each one catches something the others
 * cannot
 *
 * `ownRole()` answers **404** for a platform template: from the writing side
 * there is no role at this identifier that belongs to you, and saying so is
 * more honest than a 403 that confirms one exists. `Gate::authorize('update')`
 * routes the same question through `RolePolicy::additionalConditions`, which
 * has refused `is_system` roles since the foundation and — AA1 being the first
 * phase to call a policy from HTTP on this surface — is finally the thing it
 * was written to be. And the `roles` RLS policy refuses the UPDATE at the
 * database, because a null `organisation_id` can never match an organisation
 * identifier in a session variable.
 *
 * Three layers for one rule is not belt-and-braces for its own sake: the first
 * is the only one that can give a good answer, the second is the only one a
 * future condition will be added to, and the third is the only one that holds
 * if the other two are bypassed.
 *
 * ## `If-Match` is required, and the version is compared inside the write
 *
 * The `precondition` middleware guarantees the header is present (428
 * otherwise); {@see ReadsPrecondition} turns a header that is not a Healthy360
 * validator into a 400; and `RoleWriter` compares it inside the same `UPDATE`
 * that writes, so the check cannot be won by a row that changed between the
 * read and the write. Two administrators editing one role — one removing
 * `order.manage_organisation` while the other adds a cost code — is the
 * ordinary case on a shared console, and last-write-wins would silently restore
 * a permission somebody believes they revoked.
 */
final class OrganisationRoleUpdateController
{
    use ReadsPrecondition;
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
    public function __invoke(UpdateOrganisationRoleRequest $request, string $organisation, string $role): JsonResponse
    {
        $this->locator->contextOrganisation($organisation);
        $record = $this->locator->ownRole($role);

        Gate::authorize('update', $record);

        $actor = $this->currentUser($request);

        $updated = $this->writer->update(
            $record,
            $request->payload(),
            $this->requiredLockVersion($request),
            $actor,
            $this->actorMembershipId($this->tenant),
            $this->actorCodes($actor, $this->tenant, $this->checker),
        );

        $codes = $this->query->codesForRole((string) $updated->getKey());

        return ApiResponse::data([
            'role' => $this->presenter->detail(
                $updated,
                $this->query->holderCountFor((string) $updated->getKey()),
                $codes,
                $this->actorName($actor),
            ),
        ])->header('ETag', '"'.(int) $updated->lock_version.'"');
    }

    /**
     * The editor is the caller, so the name comes from the actor rather than a
     * second lookup of the row we have just written.
     */
    private function actorName(User $actor): ?string
    {
        $profile = $actor->profile;

        if ($profile === null) {
            return null;
        }

        return trim($profile->given_name.' '.$profile->family_name);
    }
}
