<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\B2b\Presenters\KycDocumentPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/b2b/applications/{application}/documents — metadata only.
 *
 * **There is no URL in this response and there must never be one.** The model
 * hides `disk` and `path`, the presenter is a hand-written allowlist that omits
 * them, and the only route to the bytes is a short-lived signed link minted by
 * a separate endpoint that records who asked and why. A listing that carried
 * links would defeat the expiry, the audit trail and the per-access purpose all
 * at once — and a listing is exactly the response somebody pastes into a chat.
 *
 * **Every document is listed, including rejected and superseded ones.** The
 * service's `currentDocuments()` filter is for answering "what does this
 * application still owe"; an applicant looking at their own paperwork needs to
 * see the scan that was turned down, and *why*, or the rejection is a dead end.
 *
 * Not cursor-paginated. The set is bounded by a checklist of ten document
 * kinds plus re-uploads, and a page boundary through somebody's KYC pack would
 * be ceremony over a list that fits on a screen.
 */
final class KycDocumentIndexController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly KycDocumentPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $application): JsonResponse
    {
        $record = $this->locator->ownApplication($application, $this->currentUser($request));

        $documents = KycDocument::query()
            ->where('b2b_application_id', $record->getKey())
            ->orderBy('document_kind')
            ->orderBy('uploaded_at')
            ->get();

        return ApiResponse::data(
            $documents->map(fn (KycDocument $document): array => $this->presenter->document($document))->all(),
            ['count' => $documents->count()],
        );
    }
}
