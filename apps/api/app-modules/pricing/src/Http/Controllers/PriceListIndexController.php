<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Presenters\PriceListAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/price-lists — every tariff this organisation quotes.
 *
 * Cursor-paginated, unlike the sales-channel list: a kitchen has a handful of
 * channels but can accumulate a tariff per corporate client, and "a handful"
 * stops being true at the first B2B account.
 *
 * Archived lists are excluded unless asked for by name — the rule the
 * ingredient, recipe and item lists apply to withdrawn rows, for the reason
 * that matters most here: a list offered by default is a list somebody assigns
 * to a channel.
 *
 * **No amounts.** The header carries a currency and a status, never a price;
 * the numbers are behind `…/entries`, one list at a time. That is not
 * squeamishness — a list endpoint that embedded its rows would serve an entire
 * kitchen's negotiated pricing in one response to any caller holding
 * `price_list.view_organisation`, and cursor pages are exactly the shape that
 * gets exported wholesale.
 */
final class PriceListIndexController
{
    public function __construct(private readonly PriceListAdminPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = PriceList::query();

        $this->applyStatus($request, $query);
        $this->applyScope($request, $query);
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
                $rows->map(fn (PriceList $list): array => $this->presenter->priceList($list))->all(),
                OffsetPage::meta($rows, $requestedPage, $perPage, $total),
            );
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (PriceList $list): array => $this->presenter->priceList($list))->all(),
            $page['meta'],
        );
    }

    /**
     * @param  Builder<PriceList>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            $query->where('status', '!=', PriceListStatus::Archived->value);

            return;
        }

        if (! is_string($status) || PriceListStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: draft, active, archived.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
    }

    /**
     * @param  Builder<PriceList>  $query
     *
     * @throws ApiException
     */
    private function applyScope(Request $request, Builder $query): void
    {
        $scope = $request->query('customer_scope');

        if ($scope === null || $scope === '') {
            return;
        }

        if (! is_string($scope) || CustomerScope::tryFrom($scope) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The customer_scope filter must be one of: public, agreement.',
                ['parameter' => 'customer_scope'],
            );
        }

        $query->where('customer_scope', $scope);
    }

    /**
     * @param  Builder<PriceList>  $query
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
