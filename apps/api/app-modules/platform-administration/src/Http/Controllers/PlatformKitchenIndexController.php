<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Controllers;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\PlatformAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\PlatformAdministration\Presenters\PlatformKitchenPresenter;
use Healthy360\PlatformAdministration\Services\KitchenOrganisationLocator;
use Healthy360\PlatformAdministration\Services\KitchenOverviewQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Enums\DataClassification;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/platform/organisations/kitchens — every kitchen on the platform.
 *
 * **Newest first**, unlike the B2B application queue. That queue is work to be
 * done and the fair order is arrival; this is an inventory, and the kitchen an
 * operator is looking for is overwhelmingly the one somebody just created or
 * just complained about.
 *
 * The `status` filter accepts any organisation status, including `closed`.
 * Offboarding does not currently produce closed kitchens — it winds up
 * corporate customers — but narrowing the vocabulary to the subset that
 * happens to be reachable today would be a rule to unpick later rather than a
 * safeguard.
 *
 * The read is audited as a classified access. A list of kitchens is one thing;
 * the owner names and email addresses that come with each row are personal
 * data, and "who looked at the operator console" is a question that gets asked.
 */
final class PlatformKitchenIndexController
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
    public function __invoke(Request $request): JsonResponse
    {
        $query = $this->locator->kitchens();

        $this->applyStatus($request, $query);
        $this->applySearch($request, $query);

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), true);

        $page = CursorPage::page($query->get(), $limit);

        /** @var list<Organisation> $kitchens */
        $kitchens = $page['items']->all();
        $overview = $this->overview->forAll($kitchens);

        $this->audit->recordAccess(
            'platform.kitchen_list_read',
            PurposeOfUse::OrganisationAdministration,
            DataClassification::Confidential,
            actorUserId: (string) $this->currentUser($request)->getKey(),
            subjectType: 'organisation',
            subjectId: null,
            metadata: ['count' => count($kitchens)],
        );

        return ApiResponse::data(
            array_map(
                fn (Organisation $kitchen): array => $this->presenter->summary(
                    $kitchen,
                    $overview[(string) $kitchen->getKey()],
                ),
                $kitchens,
            ),
            $page['meta'],
        );
    }

    /**
     * @param  Builder<Organisation>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            return;
        }

        if (! is_string($status) || OrganisationStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: active, suspended, pending, closed.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
    }

    /**
     * @param  Builder<Organisation>  $query
     */
    private function applySearch(Request $request, Builder $query): void
    {
        $term = $request->query('query');

        if (! is_string($term) || trim($term) === '') {
            return;
        }

        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->where(function (Builder $scoped) use ($needle): void {
            $scoped->whereRaw('lower(name) like ?', [$needle])
                ->orWhereRaw('lower(slug) like ?', [$needle]);
        });
    }
}
