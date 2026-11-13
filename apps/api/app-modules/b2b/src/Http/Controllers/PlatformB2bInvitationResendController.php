<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\B2b\Presenters\OrganisationInvitationPresenter;
use Healthy360\B2b\Services\ApplicationNotices;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\InvitationService;
use Healthy360\B2b\Services\IssuedInvitation;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * POST /api/v1/platform/b2b/applications/{application}/invitations/{invitation}/resend
 * — a fresh link for a contact who lost the first one or let it expire.
 *
 * Requires `b2b_application.provision_platform`: sending a link that grants
 * access to a company is the same authority as creating the company. The old
 * token is revoked by `InvitationService::issue()`, which supersedes any
 * outstanding offer to the same address, so only the newest link works.
 */
final class PlatformB2bInvitationResendController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly InvitationService $invitations,
        private readonly ApplicationNotices $notices,
        private readonly OrganisationInvitationPresenter $presenter,
        private readonly DatabaseTenantContext $database,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $application, string $invitation): JsonResponse
    {
        $record = $this->locator->application($application);
        $organisation = Organisation::query()->whereKey($record->getAttribute('provisioned_organisation_id'))->first();

        $previous = $organisation instanceof Organisation && Str::isUuid($invitation)
            ? OrganisationInvitation::query()->where('organisation_id', $organisation->getKey())->whereKey($invitation)->first()
            : null;

        if (! $organisation instanceof Organisation || ! $previous instanceof OrganisationInvitation) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        if ($previous->accepted_at !== null) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This invitation was already accepted.');
        }

        $actor = $this->currentUser($request);

        // As the company: `issue()` checks the role exists there, and `roles`
        // carries row-level security the platform's own session cannot see past.
        $issued = $this->database->during(
            (string) $actor->getKey(),
            (string) $organisation->getKey(),
            null,
            fn (): IssuedInvitation => $this->invitations->issue($organisation, $previous->email, $previous->role_code, $actor, null, $previous->message),
        );
        $this->notices->invited($organisation, $previous->email, $issued->token);

        return ApiResponse::data(['invitation' => $this->presenter->invitation($issued->invitation)], status: 201);
    }
}
