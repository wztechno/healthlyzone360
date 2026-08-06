<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Controllers;

use Healthy360\PlatformAdministration\Http\Concerns\ReadsPrecondition;
use Healthy360\PlatformAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\PlatformAdministration\Presenters\PlatformKitchenPresenter;
use Healthy360\PlatformAdministration\Services\KitchenLifecycle;
use Healthy360\PlatformAdministration\Services\KitchenOrganisationLocator;
use Healthy360\PlatformAdministration\Services\KitchenOverviewQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/organisations/kitchens/{organisation}/reactivate.
 *
 * The twin of suspend, and a separate endpoint rather than the same one with a
 * different payload. Reactivating clears the suspension note, so it takes no
 * body at all: the reason a kitchen *was* suspended belongs to the audit log
 * after this, and asking for a reason to un-suspend would invite somebody to
 * write the counter-argument into a column that gets wiped by the next
 * suspension.
 */
final class PlatformKitchenReactivateController
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
    public function __invoke(Request $request, string $organisation): JsonResponse
    {
        $kitchen = $this->lifecycle->reactivate(
            $this->locator->kitchen($organisation),
            $this->currentUser($request),
            $this->requiredLockVersion($request),
        );

        return ApiResponse::data([
            'kitchen' => $this->presenter->summary($kitchen, $this->overview->forOne($kitchen)),
        ])->withHeaders(['ETag' => '"'.$kitchen->lock_version.'"']);
    }
}
