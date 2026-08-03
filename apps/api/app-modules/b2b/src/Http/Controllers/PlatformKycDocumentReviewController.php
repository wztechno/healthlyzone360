<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\ReviewKycDocumentRequest;
use Healthy360\B2b\Presenters\KycDocumentPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\KycDocumentService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/b2b/documents/{document}/review — a reviewer's verdict.
 *
 * **Two permissions, stacked**: `kyc_document.view_platform` and
 * `b2b_application.review_platform`. Deciding whether a passport scan is
 * acceptable requires both the authority to look at it and the authority to
 * work the case, and either alone is the wrong answer — somebody who may open
 * documents but not review applications is an auditor, and somebody who may
 * review applications but not open documents cannot have formed a view about
 * this one. Middleware groups compose, so the second code is an additional
 * gate rather than a replacement.
 *
 * **The document is addressed directly, without its application in the path**,
 * unlike every other document route here. A verdict is about the file rather
 * than about the file's owner, and a reviewer works from the pack on the
 * application screen where each row already carries its own identifier.
 *
 * Accepting **supersedes** the previously accepted document of the same kind:
 * a company that re-uploads a clearer scan has one current registration
 * document, and the old row stays as the trail of what was looked at and when.
 * A second verdict on the same document is `409` — a review is a decision, and
 * a decision that could be quietly retaken is not one.
 *
 * A rejection must carry a `rejection_reason` from the closed vocabulary,
 * because that half is what the applicant is shown and "please re-upload, it
 * was illegible" is actionable where a reviewer's private note is not. The
 * note survives in `review_note` and stays internal — the response here is the
 * platform shape, which serves it.
 *
 * No `precondition`. `kyc_documents` carries no `lock_version`, and the
 * already-reviewed conflict is a stronger guarantee than a validator would be:
 * it refuses a second verdict outright rather than only refusing a stale one.
 */
final class PlatformKycDocumentReviewController
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
    public function __invoke(ReviewKycDocumentRequest $request, string $document): JsonResponse
    {
        $record = $this->locator->anyDocument($document);

        $reviewed = $this->documents->review(
            $record,
            $request->verdict(),
            $this->currentUser($request),
            $request->rejectionReason(),
            $request->note(),
        );

        return ApiResponse::data(['document' => $this->presenter->review($reviewed)]);
    }
}
