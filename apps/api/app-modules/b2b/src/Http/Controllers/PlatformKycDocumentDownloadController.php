<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ReadsAccessPurpose;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\KycDocumentService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET
 * /api/v1/platform/b2b/applications/{application}/documents/{document}/download
 * — a reviewer opening somebody's identity document.
 *
 * Requires `kyc_document.view_platform`, which is **narrower than the
 * application read on purpose**. A KYC pack is identity documents belonging to
 * a named person — a passport photograph, a registration certificate — and
 * being able to work a review queue is not by itself a reason to open one. The
 * queue and the file are `b2b_application.view_platform`; the bytes are this.
 *
 * `purpose` is a **required** query parameter and goes straight onto the audit
 * event through `KycDocumentService::temporaryUrl()`. This is the endpoint that
 * rule exists for: an applicant fetching back their own upload is unremarkable,
 * and a member of platform staff opening a stranger's passport is the access an
 * audit trail must be able to explain afterwards. Neither the object path nor
 * the signed URL is ever recorded there — writing either into a table read by
 * more people than the document is would put a live grant of access into the
 * trail.
 *
 * A URL in the envelope rather than a `302`, for the reason the applicant's
 * endpoint gives: a redirect puts an expiring credential into browser history,
 * the referrer chain and every proxy log on the way to the bucket, and hides
 * from the client that it is holding one at all.
 *
 * The document is resolved **inside** the application in the path, so a
 * reviewer holding one case's identifier cannot reach another case's pack by
 * pairing it with a stray document id.
 */
final class PlatformKycDocumentDownloadController
{
    use ReadsAccessPurpose;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly KycDocumentService $documents,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $application, string $document): JsonResponse
    {
        $record = $this->locator->application($application);
        $file = $this->locator->document($record, $document);

        $purpose = $this->accessPurpose($request);
        $expiresAt = $this->temporaryUrlExpiry();

        return ApiResponse::data([
            'download' => [
                'url' => $this->documents->temporaryUrl($file, $this->currentUser($request), $purpose),
                'expires_at' => $expiresAt->toIso8601String(),
            ],
        ]);
    }
}
