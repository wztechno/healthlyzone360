<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Models\B2bApplicationLocation;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/b2b/applications/{application} — the applicant's own file.
 *
 * Returns `ETag: "<lock_version>"` — the client's half of the
 * optimistic-concurrency contract: read the resource, keep the validator, send
 * it back as `If-Match` when writing a section, submitting or withdrawing.
 *
 * The contacts and the locations come with it. Opening an application and
 * immediately asking "and who did we name, and where did we say to deliver"
 * is one interaction, not three, and both sets are bounded by what a human
 * typed into one form — four contacts and a handful of sites.
 *
 * Documents and agreements are **not** here. Both have their own lifecycle,
 * their own review and their own permission on the platform side, and folding
 * them in would mean a wizard polling a passport scan's review state every
 * time it re-read the form.
 *
 * Somebody else's application is `404`, never `403`. That matches
 * `ApplicationService::assertApplicant()` exactly and is deliberate: telling a
 * stranger "that exists but is not yours" turns an identifier into a probe for
 * which companies have applied.
 */
final class B2bApplicationShowController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly B2bApplicationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $application): JsonResponse
    {
        $record = $this->locator->ownApplication($application, $this->currentUser($request));

        return ApiResponse::data([
            'application' => $this->presenter->application($record),
            'contacts' => $this->contacts($record),
            'locations' => $this->locations($record),
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
}
