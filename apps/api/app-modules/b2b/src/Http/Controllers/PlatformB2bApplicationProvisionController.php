<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Presenters\B2bAgreementPresenter;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Presenters\ProvisioningPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\ProvisionApplication;
use Healthy360\Organisations\Presenters\OrganisationPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Random\RandomException;

/**
 * POST /api/v1/platform/b2b/applications/{application}/provision — turn an
 * approval into a tenant.
 *
 * Requires `b2b_application.provision_platform`, the fourth and narrowest of
 * the B2B codes. It is separate from deciding because it is the **irreversible
 * half**: an approval can be revisited, a provisioned tenant cannot be
 * un-provisioned, and the person who signs off commercially is not necessarily
 * the person trusted to create organisations.
 *
 * ## `Idempotency-Key` is mandatory, and the controller is what enforces it
 *
 * The `idempotency` middleware only enforces *semantics* when a key is
 * present — a request without one passes straight through, which is the right
 * default for the many endpoints where a key is optional and the wrong one
 * here. So an absent or blank header is refused here with
 * `400 request.invalid` and `details.header`, before anything runs. A retry
 * with no key against a command that creates an organisation, a trading
 * account and a set of invitations would be unrecoverable rather than merely
 * wasteful.
 *
 * The key is not the only protection and is not asked to be. A replay of the
 * *same* request is answered by the middleware from the stored envelope; two
 * genuinely different requests — a reviewer with two tabs open — are answered
 * by `ProvisionApplication`, which finds the application already linked and
 * returns the existing records rather than creating a second organisation.
 * `invitations_issued` is `0` on that path, so a caller can tell a replay from
 * fresh work.
 *
 * ## No `precondition`
 *
 * Deliberately. `If-Match` protects a *lost update* — two writers overwriting
 * each other's version of one field — and this command has no such shape: it
 * refuses unless the status is `approved` and refuses to run twice at all.
 * Adding a validator would mean a reviewer who had merely re-read the file in
 * another tab could not provision, which is friction bought with no safety.
 *
 * `200`, not `201`. Several records were created and no one of them is *the*
 * thing this endpoint made; a `Location` header would have to pick one and
 * would be lying about the rest.
 */
final class PlatformB2bApplicationProvisionController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly ProvisionApplication $provisioning,
        private readonly B2bApplicationPresenter $presenter,
        private readonly OrganisationPresenter $organisations,
        private readonly ProvisioningPresenter $accounts,
        private readonly B2bAgreementPresenter $agreements,
    ) {}

    /**
     * @throws ApiException
     * @throws RandomException
     */
    public function __invoke(Request $request, string $application): JsonResponse
    {
        $this->requireIdempotencyKey($request);

        $record = $this->locator->application($application);
        $outcome = $this->provisioning->provision($record, $this->currentUser($request));

        $agreement = $outcome['agreement'];

        return ApiResponse::data([
            'application' => $this->presenter->review($record->refresh()),
            'organisation' => $this->organisations->organisation($outcome['organisation']),
            'customer_account' => $this->accounts->customerAccount($outcome['customerAccount']),
            'agreement' => $agreement instanceof B2bAgreement ? $this->agreements->agreement($agreement) : null,
            'invitations_issued' => $outcome['invitations'],
        ]);
    }

    /**
     * @throws ApiException
     */
    private function requireIdempotencyKey(Request $request): void
    {
        $key = $request->header('Idempotency-Key');

        if (! is_string($key) || trim($key) === '') {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'Provisioning creates records that cannot be un-created. Send an Idempotency-Key so a retry is safe.',
                ['header' => 'Idempotency-Key'],
            );
        }
    }
}
