<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Controllers;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\PlatformAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\PlatformAdministration\Presenters\PlatformKitchenPresenter;
use Healthy360\PlatformAdministration\Services\KitchenOrganisationLocator;
use Healthy360\PlatformAdministration\Services\KitchenOverviewQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Enums\DataClassification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/platform/organisations/kitchens/{organisation} — one kitchen in
 * full.
 *
 * Carries an `ETag` because the two lifecycle actions on this resource demand
 * an `If-Match`. A client that could not obtain a validator from the read
 * would have no way to send one on the write, which is the failure mode
 * `precondition` exists to prevent rather than cause.
 *
 * `{organisation}` is a slug or an identifier — see `KitchenOrganisationLocator`.
 */
final class PlatformKitchenShowController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly KitchenOrganisationLocator $locator,
        private readonly KitchenOverviewQuery $overview,
        private readonly PlatformKitchenPresenter $presenter,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $organisation): JsonResponse
    {
        $kitchen = $this->locator->kitchen($organisation);

        /** @var list<OrganisationBranch> $branches */
        $branches = OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $kitchen->getKey())
            ->orderBy('name')
            ->get()
            ->all();

        $this->audit->recordAccess(
            'platform.kitchen_read',
            PurposeOfUse::OrganisationAdministration,
            DataClassification::Confidential,
            actorUserId: (string) $this->currentUser($request)->getKey(),
            subjectType: 'organisation',
            subjectId: (string) $kitchen->getKey(),
            metadata: ['slug' => $kitchen->slug],
        );

        return ApiResponse::data([
            'kitchen' => $this->presenter->detail(
                $kitchen,
                $this->overview->forOne($kitchen),
                $branches,
            ),
        ])->withHeaders(['ETag' => '"'.$kitchen->lock_version.'"']);
    }
}
