<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Presenters\B2bAgreementPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/b2b/applications/{application}/agreements/{agreement} — one
 * version of the terms.
 *
 * Returns `ETag: "<lock_version>"`. The signing endpoint does not consume it —
 * `AgreementService::sign()` refuses on the *state* rather than on a validator,
 * because "only an agreement that has been sent for signature can be signed" is
 * a stronger guarantee than "only if nobody edited it since you looked" — but
 * the validator is still the honest thing to serve, and it is what a future
 * amendment endpoint will require.
 *
 * The agreement is resolved **inside** the application in the path, so one
 * company's identifier can never reach another's negotiated position. That
 * matters more here than anywhere else in the module: a credit limit and a
 * price list are the most commercially sensitive rows the platform stores.
 */
final class B2bAgreementShowController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly B2bAgreementPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $application, string $agreement): JsonResponse
    {
        $record = $this->locator->ownApplication($application, $this->currentUser($request));
        $terms = $this->locator->agreement($record, $agreement);

        return ApiResponse::data(['agreement' => $this->presenter->agreement($terms)])
            ->withHeaders(['ETag' => '"'.$terms->lock_version.'"']);
    }
}
