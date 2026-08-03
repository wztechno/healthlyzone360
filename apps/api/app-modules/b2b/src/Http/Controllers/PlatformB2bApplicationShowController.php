<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Models\B2bApplicationLocation;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Presenters\KycDocumentPresenter;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/platform/b2b/applications/{application} — the whole file, as a
 * reviewer sees it.
 *
 * Requires `b2b_application.view_platform`. Everything a decision rests on
 * arrives in one response — the answers, the people, the sites, the document
 * pack and the duplicate matches — because a reviewer who has to make five
 * calls to form one judgement will eventually make four.
 *
 * **Documents are metadata only, and that is a second permission's business.**
 * The pack is listed here so a reviewer can see what has been filed and what
 * is still pending; *opening* one needs `kyc_document.view_platform`, which is
 * deliberately narrower. Being able to work a queue is not by itself a reason
 * to look at somebody's passport, and every download states a purpose and is
 * audited.
 *
 * ## Duplicates surface, and never decide
 *
 * `duplicate_matches` is a count and `duplicate_applications` is the list
 * behind it. A count with no way to reach the matches is a number a reviewer
 * cannot act on; the list is deliberately the thin queue shape, because the
 * reviewer's next act is to open one, not to read it here.
 *
 * A second application against the same registration is **routine** — a first
 * attempt declined for something fixable, a franchise group, a lapsed licence
 * renewed — and the platform auto-rejecting it would make its own convenience
 * the customer's problem. Nothing on this response is a verdict.
 *
 * `ETag` is the application's validator, and every reviewer action —
 * claiming, asking, approving, declining — sends it back as `If-Match`.
 */
final class PlatformB2bApplicationShowController
{
    public function __construct(
        private readonly B2bLocator $locator,
        private readonly ApplicationService $applications,
        private readonly B2bApplicationPresenter $presenter,
        private readonly KycDocumentPresenter $documents,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $application): JsonResponse
    {
        $record = $this->locator->application($application);
        $duplicates = $this->applications->duplicateMatches($record);

        return ApiResponse::data([
            'application' => $this->presenter->review($record),
            'contacts' => $this->contacts($record),
            'locations' => $this->locations($record),
            'documents' => $this->documentPack($record),
            'missing_documents' => $this->applications->missingRequiredDocuments($record),
            'duplicate_matches' => count($duplicates),
            'duplicate_applications' => array_map(
                fn (B2bApplication $match): array => $this->presenter->summary($match),
                $duplicates,
            ),
        ])->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function contacts(B2bApplication $application): array
    {
        return array_values(B2bApplicationContact::query()
            ->where('b2b_application_id', $application->getKey())
            ->orderBy('role')
            ->get()
            ->map(fn (B2bApplicationContact $contact): array => $this->presenter->contact($contact))
            ->all());
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function locations(B2bApplication $application): array
    {
        return array_values(B2bApplicationLocation::query()
            ->where('b2b_application_id', $application->getKey())
            ->orderByDesc('is_primary')
            ->orderBy('label')
            ->get()
            ->map(fn (B2bApplicationLocation $location): array => $this->presenter->location($location))
            ->all());
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function documentPack(B2bApplication $application): array
    {
        return array_values(KycDocument::query()
            ->where('b2b_application_id', $application->getKey())
            ->orderBy('document_kind')
            ->orderBy('uploaded_at')
            ->get()
            ->map(fn (KycDocument $document): array => $this->documents->review($document))
            ->all());
    }
}
