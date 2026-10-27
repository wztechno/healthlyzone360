<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\B2b\Presenters\OrganisationInvitationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/platform/b2b/applications/{application}/invitations — who
 * provisioning invited into the new company, and whether they came.
 *
 * Requires `b2b_application.view_platform`. The platform is not a member of
 * the organisation it created, so the organisation's own invitation list is
 * closed to it; this is the reviewer's view of the same rows. Empty before
 * provisioning.
 */
final class PlatformB2bInvitationIndexController
{
    public function __construct(
        private readonly B2bLocator $locator,
        private readonly OrganisationInvitationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $application): JsonResponse
    {
        $record = $this->locator->application($application);
        $organisationId = $record->getAttribute('provisioned_organisation_id');

        $invitations = is_string($organisationId)
            ? OrganisationInvitation::query()->where('organisation_id', $organisationId)->orderByDesc('created_at')->get()
            : collect();

        return ApiResponse::data(
            $invitations->map(fn (OrganisationInvitation $invitation): array => $this->presenter->invitation($invitation))->values()->all(),
        );
    }
}
