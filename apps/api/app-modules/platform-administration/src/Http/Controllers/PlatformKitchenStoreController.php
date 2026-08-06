<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Controllers;

use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\PlatformAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\PlatformAdministration\Http\Requests\StoreKitchenOrganisationRequest;
use Healthy360\PlatformAdministration\Presenters\PlatformKitchenPresenter;
use Healthy360\PlatformAdministration\Services\KitchenOverviewQuery;
use Healthy360\PlatformAdministration\Services\KitchenProvisioning;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/organisations/kitchens — create a kitchen.
 *
 * **Behind `idempotency`**, on the same terms as B2B provisioning: a tenant
 * cannot be un-created, and a retried request that produced a second kitchen
 * with a suffixed slug would be discovered by whoever went looking for the
 * first one. The unique slug would refuse an exact duplicate, but only after
 * the branch and the channel had been written and rolled back, and only with a
 * validation error where a replay belongs.
 *
 * Answers `201` with the same body the show endpoint returns, so a console can
 * navigate straight to the new kitchen without a second read.
 */
final class PlatformKitchenStoreController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly KitchenProvisioning $provisioning,
        private readonly KitchenOverviewQuery $overview,
        private readonly PlatformKitchenPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreKitchenOrganisationRequest $request): JsonResponse
    {
        $kitchen = $this->provisioning->create(
            $request->payload(),
            $this->currentUser($request),
        );

        /** @var list<OrganisationBranch> $branches */
        $branches = OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $kitchen->getKey())
            ->orderBy('name')
            ->get()
            ->all();

        return ApiResponse::data([
            'kitchen' => $this->presenter->detail(
                $kitchen,
                $this->overview->forOne($kitchen),
                $branches,
            ),
        ], status: 201)->withHeaders(['ETag' => '"'.$kitchen->lock_version.'"']);
    }
}
