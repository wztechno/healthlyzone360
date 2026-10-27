<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Presenters\B2bAgreementPresenter;
use Healthy360\B2b\Services\AgreementService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/b2b/agreements/{agreement}/revise — take back an
 * agreement waiting for signature and open the next version as a draft,
 * behind `precondition`.
 *
 * Requires `b2b_application.decide_platform`. Answers `201` with the new
 * draft; the version that was sent is kept, terminated, on record.
 */
final class PlatformB2bAgreementReviseController
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
    public function __invoke(Request $request, string $agreement): JsonResponse
    {
        $record = $this->locator->anyAgreement($agreement);
        $this->assertCurrentVersion($request, $record->lock_version);

        $draft = $this->agreements->revise($record, $this->currentUser($request));

        return ApiResponse::data(['agreement' => $this->presenter->agreement($draft)], status: 201)
            ->withHeaders(['ETag' => '"'.$draft->lock_version.'"']);
    }
}
