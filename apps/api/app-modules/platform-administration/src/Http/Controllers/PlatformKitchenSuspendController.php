<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Controllers;

use Healthy360\PlatformAdministration\Http\Concerns\ReadsPrecondition;
use Healthy360\PlatformAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\PlatformAdministration\Http\Requests\SuspendKitchenOrganisationRequest;
use Healthy360\PlatformAdministration\Presenters\PlatformKitchenPresenter;
use Healthy360\PlatformAdministration\Services\KitchenLifecycle;
use Healthy360\PlatformAdministration\Services\KitchenOrganisationLocator;
use Healthy360\PlatformAdministration\Services\KitchenOverviewQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/organisations/kitchens/{organisation}/suspend.
 *
 * A sub-resource action, never `PATCH status` — see `KitchenLifecycle` for
 * why. Behind `precondition`, because two operators sharing a console is the
 * ordinary case and last-write-wins on "is this business allowed to trade" is
 * not a defensible way to settle it.
 */
final class PlatformKitchenSuspendController
{
    use ReadsPrecondition;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly KitchenOrganisationLocator $locator,
        private readonly KitchenLifecycle $lifecycle,
        private readonly KitchenOverviewQuery $overview,
        private readonly PlatformKitchenPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(SuspendKitchenOrganisationRequest $request, string $organisation): JsonResponse
    {
        $kitchen = $this->lifecycle->suspend(
            $this->locator->kitchen($organisation),
            $this->currentUser($request),
            $request->reason(),
            $this->requiredLockVersion($request),
        );

        return ApiResponse::data([
            'kitchen' => $this->presenter->summary($kitchen, $this->overview->forOne($kitchen)),
        ])->withHeaders(['ETag' => '"'.$kitchen->lock_version.'"']);
    }
}
