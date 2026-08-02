<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\PutPlanProfileRequest;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Catalogues\Services\PlanProfileService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/plans/{item}/profile.
 *
 * A PUT because the profile is one commercial statement, read whole to decide
 * any part of it. A PATCH over eight interdependent switches would make "I left
 * pausing alone" and "I turned pausing off" the same request, on a right a
 * subscriber has been sold.
 *
 * `If-Match` carries the **item's** `lock_version`, and the write bumps it, so
 * a concurrent editor of the listing loses the race rather than silently
 * overwriting the terms.
 */
final class PlanProfileUpdateController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanProfileService $profiles,
        private readonly PlanAdminPresenter $presenter,
        private readonly CatalogueItemAdminPresenter $items,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(PutPlanProfileRequest $request, string $item): JsonResponse
    {
        $plan = $this->locator->plan($item);
        $profile = $this->profiles->put($plan, $request->profile(), $this->requiredLockVersion($request));
        $plan->refresh();

        return ApiResponse::data([
            'item' => $this->items->item($plan),
            'profile' => $this->presenter->profile($profile),
        ])->withHeaders(['ETag' => '"'.$plan->lock_version.'"']);
    }
}
