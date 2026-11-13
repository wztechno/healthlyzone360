<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\AgreementTermsRequest;
use Healthy360\B2b\Presenters\B2bAgreementPresenter;
use Healthy360\B2b\Services\AgreementService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/b2b/applications/{application}/agreements — the
 * reviewer drafts the terms of an approved application.
 *
 * Requires `b2b_application.decide_platform`: the terms are the commercial
 * half of the decision. The draft is invisible to the applicant until it is
 * sent for signature.
 */
final class PlatformB2bAgreementStoreController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly AgreementService $agreements,
        private readonly B2bAgreementPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(AgreementTermsRequest $request, string $application): JsonResponse
    {
        $record = $this->locator->application($application);

        $agreement = $this->agreements->openDraft($record, $request->title(), $request->terms(), $this->currentUser($request));

        return ApiResponse::data(['agreement' => $this->presenter->agreement($agreement)], status: 201)
            ->withHeaders(['ETag' => '"'.$agreement->lock_version.'"']);
    }
}
