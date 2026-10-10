<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use Healthy360\AccessAdministration\Http\Concerns\ReadsPrecondition;
use Healthy360\AccessAdministration\Http\Concerns\ResolvesActorAuthority;
use Healthy360\AccessAdministration\Presenters\TeamMemberPresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessAdministration\Services\MembershipAdministration;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/organisations/{organisation}/memberships/{membership}/suspend
 *
 * A verb with its own URL rather than a status on a `PATCH`, for the reason
 * `MembershipAdministration` states: one call taking a string would let a
 * console ship a dropdown in which the one irreversible act sits beside three
 * reversible ones.
 *
 * Carries `precondition` because two administrators sharing a console is the
 * ordinary case, and one reactivating while the other suspends is a coin flip
 * that last-write-wins would settle silently — on the question of whether
 * somebody may sign in.
 */
final class OrganisationMembershipSuspendController
{
    use ReadsPrecondition;
    use ResolvesActorAuthority;

    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly AccessAdministrationQuery $query,
        private readonly MembershipAdministration $administration,
        private readonly TeamMemberPresenter $presenter,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $organisation, string $membership): JsonResponse
    {
        $tenant = $this->locator->contextOrganisation($organisation);
        $record = $this->locator->membership($membership);

        $updated = $this->administration->suspend(
            $record,
            $this->requiredLockVersion($request),
            $this->actorMembershipId($this->tenant),
        );

        return MembershipResponse::detail($updated, $tenant, $this->query, $this->presenter);
    }
}
