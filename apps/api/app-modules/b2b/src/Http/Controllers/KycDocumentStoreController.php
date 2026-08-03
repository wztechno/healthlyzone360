<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\StoreKycDocumentRequest;
use Healthy360\B2b\Presenters\KycDocumentPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\DocumentOwner;
use Healthy360\B2b\Services\KycDocumentService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/b2b/applications/{application}/documents — **multipart**.
 *
 * The one endpoint in this family that is not JSON in, and it has to be:
 * base64 in a JSON body would inflate every upload by a third and would put a
 * ten-megabyte string through the request pipeline as a PHP value rather than
 * as a file on disk.
 *
 * **This controller decides almost nothing about the file.** The size bound is
 * checked by the form request because it is worth refusing early; everything
 * that matters — what the bytes actually are, whether that type is accepted,
 * the digest, where it is stored — is `KycDocumentService`'s, and it sniffs the
 * leading bytes rather than believing the client's `Content-Type` or the
 * filename. The uploader's filename never reaches the object key at all.
 *
 * **A re-upload of identical bytes returns the existing row**, and the service
 * does that rather than refusing, which is what makes a flaky connection or a
 * double-tapped button harmless. The status is still `201`: the client asked
 * for a document to exist against this application and, when the response
 * arrives, it does.
 *
 * No `precondition`. A document is appended beside the application rather than
 * mutating it, so there is no lost update for an `If-Match` to prevent.
 */
final class KycDocumentStoreController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly KycDocumentService $documents,
        private readonly KycDocumentPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreKycDocumentRequest $request, string $application): JsonResponse
    {
        $actor = $this->currentUser($request);
        $record = $this->locator->ownApplication($application, $actor);
        $file = $request->document();

        if ($file === null) {
            // Reachable when a client sends the field but the upload failed in
            // transit — PHP hands over a part with an error rather than a
            // usable file, and `required|file` has already passed on it.
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'The upload did not arrive intact. Send it again.',
                ['fields' => ['file' => ['The upload did not arrive intact.']]],
            );
        }

        $document = $this->documents->store(
            $file,
            DocumentOwner::application($record),
            $request->documentKind(),
            $actor,
            $request->expiresOn(),
        );

        return ApiResponse::data(['document' => $this->presenter->document($document)], status: 201);
    }
}
