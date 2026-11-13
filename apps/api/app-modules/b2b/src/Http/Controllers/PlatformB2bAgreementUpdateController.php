<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\AgreementTermsRequest;
use Healthy360\B2b\Presenters\B2bAgreementPresenter;
use Healthy360\B2b\Services\AgreementService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/platform/b2b/agreements/{agreement} — change a draft's terms,
 * behind `precondition`.
 *
 * Requires `b2b_application.decide_platform`. Only a draft changes; one that
 * has been sent is revised into a new version instead.
 */
final class PlatformB2bAgreementUpdateController
{
    use ReadsPrecondition;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly AgreementService $agreements,
        private readonly B2bAgreementPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(AgreementTermsRequest $request, string $agreement): JsonResponse
    {
        $record = $this->locator->anyAgreement($agreement);
        $this->assertCurrentVersion($request, $record->lock_version);

        $updated = $this->agreements->update($record, $request->terms(), $this->currentUser($request));

        return ApiResponse::data(['agreement' => $this->presenter->agreement($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
