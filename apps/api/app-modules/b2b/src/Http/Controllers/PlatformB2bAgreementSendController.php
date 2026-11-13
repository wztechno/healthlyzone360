<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Presenters\B2bAgreementPresenter;
use Healthy360\B2b\Services\AgreementService;
use Healthy360\B2b\Services\ApplicationNotices;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/b2b/agreements/{agreement}/send — put a draft in front
 * of the signatory, behind `precondition`.
 *
 * Requires `b2b_application.decide_platform`. Refused with the fields still
 * missing when the draft names no seller price list, currency or payment
 * terms. The applicant is emailed a link to read and sign.
 */
final class PlatformB2bAgreementSendController
{
    use ReadsPrecondition;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly AgreementService $agreements,
        private readonly B2bAgreementPresenter $presenter,
        private readonly ApplicationNotices $notices,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $agreement): JsonResponse
    {
        $record = $this->locator->anyAgreement($agreement);
        $this->assertCurrentVersion($request, $record->lock_version);
        $this->agreements->assertReadyToSend($record);

        $sent = $this->agreements->sendForSignature($record, $this->currentUser($request));

        $application = $sent->application;

        if ($application instanceof B2bApplication) {
            $this->notices->agreementSent($application, $sent);
        }

        return ApiResponse::data(['agreement' => $this->presenter->agreement($sent)])
            ->withHeaders(['ETag' => '"'.$sent->lock_version.'"']);
    }
}
