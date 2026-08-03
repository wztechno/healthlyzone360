<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\ReplaceApplicationLocationsRequest;
use Healthy360\B2b\Models\B2bApplicationLocation;
use Healthy360\B2b\Presenters\B2bApplicationPresenter;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/b2b/applications/{application}/locations — set-replace of where
 * the company wants food.
 *
 * A replace rather than a merge, for the same reason the contacts endpoint is
 * one: a company that closed an office has to be able to say so, and
 * `{"locations": []}` is the payload that expresses it.
 *
 * **No `If-Match` and no `ETag`**, on the same argument: the set is the unit of
 * change, it is replaced in one transaction, and these rows carry no
 * `lock_version` because a per-row validator would let two editors replace
 * different halves of one delivery map.
 *
 * `delivery_area_id` anchors a location to the platform gazetteer where the
 * gazetteer covers it, and is optional because it often does not — a corporate
 * park in a city nobody has mapped is still somewhere a van can go, and
 * refusing the address until the gazetteer catches up would make the platform's
 * incompleteness the applicant's problem.
 */
final class B2bApplicationLocationReplaceController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly ApplicationService $applications,
        private readonly B2bApplicationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceApplicationLocationsRequest $request, string $application): JsonResponse
    {
        $actor = $this->currentUser($request);
        $record = $this->locator->ownApplication($application, $actor);

        $this->applications->replaceLocations($record, $request->locations(), $actor);

        $rows = B2bApplicationLocation::query()
            ->where('b2b_application_id', $record->getKey())
            ->orderByDesc('is_primary')
            ->orderBy('label')
            ->get();

        return ApiResponse::data([
            'locations' => $rows->map(fn (B2bApplicationLocation $location): array => $this->presenter->location($location))->all(),
        ]);
    }
}
