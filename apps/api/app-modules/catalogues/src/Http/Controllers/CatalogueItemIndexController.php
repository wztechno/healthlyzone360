<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/items — everything this organisation sells.
 *
 * There is no platform library here, unlike ingredients and product
 * categories: an item belongs to exactly one organisation, always.
 *
 * Retired items are excluded unless asked for by name — the rule the
 * ingredient and recipe lists apply to archived rows, and for the same reason:
 * a list that offered withdrawn articles by default invites somebody to price
 * one.
 */
final class CatalogueItemIndexController
{
    public function __construct(private readonly CatalogueItemAdminPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = CatalogueItem::query();

        $this->applyStatus($request, $query);
        $this->applyType($request, $query);
        $this->applyCategory($request, $query);
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
                $rows->map(fn (CatalogueItem $item): array => $this->presenter->item($item))->all(),
                OffsetPage::meta($rows, $requestedPage, $perPage, $total),
            );
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (CatalogueItem $item): array => $this->presenter->item($item))->all(),
            $page['meta'],
        );
    }

    /**
     * @param  Builder<CatalogueItem>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            $query->where('status', '!=', CatalogueItemStatus::Retired->value);

            return;
        }

        if (! is_string($status) || CatalogueItemStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: draft, review_required, published, retired.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
    }

    /**
     * @param  Builder<CatalogueItem>  $query
     *
     * @throws ApiException
     */
    private function applyType(Request $request, Builder $query): void
    {
        $type = $request->query('item_type');

        if ($type === null || $type === '') {
            return;
        }

        if (! is_string($type) || CatalogueItemType::tryFrom($type) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The item_type filter must be one of: product, meal, subscription_plan.',
                ['parameter' => 'item_type'],
            );
        }

        $query->where('item_type', $type);
    }

    /**
     * @param  Builder<CatalogueItem>  $query
     */
    private function applyCategory(Request $request, Builder $query): void
    {
        $category = $request->query('product_category_id');

        if (! is_string($category) || $category === '') {
            return;
        }

        $query->where('product_category_id', $category);
    }

    /**
     * @param  Builder<CatalogueItem>  $query
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
                ->orWhereRaw('lower(slug) like ?', [$needle]);
        });
    }
}
