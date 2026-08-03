<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\B2b\Services\ExportService;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/b2b/offboardings/{offboarding}/exports — ask for the
 * company's own records, packaged.
 *
 * **Nested under the wind-up rather than under the organisation**, which is a
 * deliberate narrowing. `ExportService::request()` will happily build a bundle
 * for any organisation with no offboarding at all, and a top-level
 * `/platform/b2b/exports` would expose that — an endpoint that packages every
 * record a company holds, available whenever anybody wants one. Nesting it
 * means an export is always attached to a reason, and `record_export.create_platform`
 * is the authority to take that copy. A standalone export surface is a real
 * future need — a data-subject request against a corporate customer, say — and
 * it should arrive with its own reason attached rather than by widening this
 * one.
 *
 * **`202`, because requesting is not building.** The row is written and
 * `ExportBusinessRecords` is queued; assembling the bundle reads an
 * organisation's whole history and hashes it, and doing that inside a request
 * would make the endpoint's latency a function of how long a company has been a
 * customer. The response comes back `requested` with no size and no digest;
 * `GET` it to find `ready`.
 *
 * **Its own permission, deliberately narrower than driving the wind-up.**
 * `b2b_offboarding.manage_platform` is the authority to end a relationship;
 * `record_export.create_platform` is the authority to take a complete copy of
 * everything a company gave the platform, which is a different act with a
 * different risk — the same argument that makes `kyc_document.view_platform`
 * narrower than reading an application. Both codes are checked; middleware
 * groups compose.
 */
final class RecordExportStoreController
{
    use ResolvesAuthenticatedUser;
    use ResolvesOffboarding;

    public function __construct(
        private readonly ExportService $exports,
        private readonly OffboardingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $offboarding): JsonResponse
    {
        $record = $this->offboarding($offboarding);
        $organisation = $record->organisation;

        if (! $organisation instanceof Organisation) {
            // The wind-up outlived its organisation, which nothing in this
            // module does on purpose. A 404 rather than a 500: there is nothing
            // to export and nothing the caller can do about it here.
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $export = $this->exports->request($organisation, $this->currentUser($request), $record);

        return ApiResponse::data(['export' => $this->presenter->export($export)], status: 202);
    }
}
