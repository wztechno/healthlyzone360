<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Controllers;

use Healthy360\AccessAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\AccessAdministration\Http\Requests\StoreStaffAccountRequest;
use Healthy360\AccessAdministration\Presenters\TeamMemberPresenter;
use Healthy360\AccessAdministration\Services\AccessAdministrationLocator;
use Healthy360\AccessAdministration\Services\AccessAdministrationQuery;
use Healthy360\AccessAdministration\Services\StaffLoginIdentity;
use Healthy360\AccessAdministration\Services\StaffProvisioning;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * POST /api/v1/organisations/{organisation}/staff — open an account for
 * somebody who has no way to open one themselves.
 *
 * ## Two authorities, stacked
 *
 * The route gate is `user.manage_organisation`; this controller additionally
 * demands `membership.invite_organisation`. Minting a login and granting it a
 * seat in the organisation are two decisions, and a kitchen may reasonably want
 * somebody who can do the second without the first. It is the shape
 * `PlatformKycDocumentReviewController` uses and the one the registry names
 * when it writes about `b2b_offboarding.waive_settlement_platform` stacking on
 * top of the code beside it.
 *
 * ## `idempotency`, unlike the role create
 *
 * A role has a natural key; a person does not, and the cost of a lost response
 * here is worse than a duplicate row. An administrator who does not know
 * whether a password was issued has to either create a second account or leave
 * somebody unable to sign in, and both are discovered by the person standing at
 * the counter.
 *
 * ## `step-up`
 *
 * The first tenant-side act in the class the two existing `step-up` routes
 * guard — device revocation and changing a primary contact. A hijacked session
 * minting itself a second, permanently-privileged account is exactly the attack
 * password re-confirmation exists for, and it is cheap here: an administrator
 * opens this form rarely and deliberately.
 *
 * ## The password appears exactly once
 *
 * It is in `data.initial_password` in this response and nowhere else — not in
 * the audit trail, not in a log line, not readable from any later request. The
 * model is `InvitationService::issue()`, which returns its plaintext token once
 * for the mail and drops it. `must_change_password` is what makes that
 * defensible: what the administrator carries out of this screen is a credential
 * good for one sign-in.
 */
final class StaffAccountStoreController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly AccessAdministrationLocator $locator,
        private readonly AccessAdministrationQuery $query,
        private readonly StaffLoginIdentity $identity,
        private readonly StaffProvisioning $provisioning,
        private readonly TeamMemberPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreStaffAccountRequest $request, string $organisation): JsonResponse
    {
        $tenant = $this->locator->contextOrganisation($organisation);

        if (! Gate::allows('membership.invite_organisation')) {
            throw new ApiException(
                ErrorCode::AuthzPermissionDenied,
                'Creating a login also grants a place in this organisation, which needs permission to invite people.',
                ['required_permission' => 'membership.invite_organisation'],
            );
        }

        $payload = $request->payload();

        $membership = $this->provisioning->provision(
            $tenant,
            [
                ...$payload,
                'email' => $this->identity->compose($tenant, $payload['email'], $payload['local_part']),
            ],
            $this->currentUser($request),
        );

        $response = MembershipResponse::detail($membership, $tenant, $this->query, $this->presenter, status: 201);

        /** @var array<string, mixed> $body */
        $body = $response->getData(true);
        $body['data']['initial_password'] = $payload['password'];

        return $response->setData($body);
    }
}
