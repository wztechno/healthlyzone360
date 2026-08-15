<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/delivery-zones — every zone this organisation has
 * drawn, its own and its branches'.
 *
 * Cursor-paginated. A kitchen with one map has three zones and a kitchen
 * covering a country has a zone per district per branch, and the second is the
 * one that has to keep working.
 *
 * Archived zones are excluded unless asked for by name — the rule the
 * ingredient, recipe, item and price-list indexes apply to withdrawn rows.
 *
 * The areas are **not** embedded. A zone can name a hundred places, and a list
 * endpoint that carried them would serve a kitchen's whole geography in one
 * response; `…/{zone}/areas` answers that question one zone at a time.
 */
final class DeliveryZoneIndexController
{
    public function __construct(private readonly DeliveryAdminPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = DeliveryZone::query();

        $this->applyStatus($request, $query);
        $this->applyBranch($request, $query);
        $this->applySearch($request, $query);

        $requestedPage = OffsetPage::page($request);

        if ($requestedPage !== null) {
            $perPage = OffsetPage::perPage($request);
            // Counted before the query is constrained: a constrained builder
            // counts the page rather than the collection.
            $total = $query->toBase()->getCountForPagination();

            OffsetPage::assertWithinRange($requestedPage, $perPage, $total);
            OffsetPage::constrain($query, $requestedPage, $perPage);

            $rows = $query->get();

            return ApiResponse::data(
                $rows->map(fn (DeliveryZone $zone): array => $this->presenter->zone($zone))->all(),
                OffsetPage::meta($rows, $requestedPage, $perPage, $total),
            );
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (DeliveryZone $zone): array => $this->presenter->zone($zone))->all(),
            $page['meta'],
        );
    }

    /**
     * @param  Builder<DeliveryZone>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            $query->where('status', '!=', DeliveryZoneStatus::Archived->value);

            return;
        }

        if (! is_string($status) || DeliveryZoneStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: active, inactive, archived.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
    }

    /**
     * `branch_id=organisation` selects the organisation-wide map, which is the
     * one thing a plain `branch_id` filter cannot express: an absent parameter
     * already means "no filter", so "the rows whose branch is null" needs a
     * word of its own.
     *
     * @param  Builder<DeliveryZone>  $query
     *
     * @throws ApiException
     */
    private function applyBranch(Request $request, Builder $query): void
    {
        $branchId = $request->query('branch_id');

        if ($branchId === null || $branchId === '') {
            return;
        }

        if (! is_string($branchId)) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The branch_id filter is a branch identifier, or the word "organisation" for the organisation-wide map.',
                ['parameter' => 'branch_id'],
            );
        }

        $branchId === 'organisation'
            ? $query->whereNull('branch_id')
            : $query->where('branch_id', $branchId);
    }

    /**
     * @param  Builder<DeliveryZone>  $query
     */
    private function applySearch(Request $request, Builder $query): void
    {
        $term = $request->query('query');

        if (! is_string($term) || trim($term) === '') {
            return;
        }

        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->where(function (Builder $scoped) use ($needle): void {
            $scoped->whereRaw('lower(name_en) like ?', [$needle])
                ->orWhereRaw('lower(name_ar) like ?', [$needle])
                ->orWhereRaw('lower(code) like ?', [$needle]);
        });
    }
}
