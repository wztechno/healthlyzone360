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
 * GET /api/v1/b2b/applications/{application}/documents/{document}/download —
 * the applicant fetching back something they filed.
 *
 * **A URL in the envelope, not a 302.** A redirect would be the shorter
 * implementation and the worse contract. The link is a signed, expiring grant
 * against object storage, and handing it over as data means a client knows it
 * holds a credential with a deadline: it can show the expiry, refresh before
 * acting, and decline to cache it. A redirect makes the same credential
 * invisible — it lands in browser history, in the referrer chain and in every
 * proxy log between here and the bucket — and a client that follows it
 * automatically cannot tell a live grant from a dead one until the download
 * fails.
 *
 * `purpose` is a **required** query parameter, passed straight to
 * `KycDocumentService::temporaryUrl()`, which writes it onto the access audit
 * event. Neither the path nor the URL itself is ever recorded there: putting
 * either into a table read by more people than the document is would be a live
 * grant of access sitting in the audit trail.
 *
 * The document is resolved *inside* the application in the path, so one
 * applicant's identifier can never reach another's passport scan.
 */
final class KycDocumentDownloadController
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
        $actor = $this->currentUser($request);
        $record = $this->locator->ownApplication($application, $actor);
        $file = $this->locator->document($record, $document);

        $purpose = $this->accessPurpose($request);
        $expiresAt = $this->temporaryUrlExpiry();

        return ApiResponse::data([
            'download' => [
                'url' => $this->documents->temporaryUrl($file, $actor, $purpose),
                'expires_at' => $expiresAt->toIso8601String(),
            ],
        ]);
    }
}
