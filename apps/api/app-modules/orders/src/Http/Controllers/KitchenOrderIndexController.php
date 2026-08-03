<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\OrderQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/orders — one kitchen's book, newest first.
 *
 * **The seller filter is not a filter.** `orders` carries no PostgreSQL policy
 * and no global Eloquent scope, because the row belongs to a customer who is a
 * member of nothing and an ambient organisation scope would hide an order from
 * the person who placed it. `OrderQuery::forSeller()` is therefore the isolation
 * boundary rather than a convenience, and the organisation comes from
 * `TenantContext` — validated by `org.context` against an active membership —
 * never from a query parameter, which would be a client asserting whose book it
 * is reading.
 *
 * **Three filters, because this list grows without limit.** Unlike a person's
 * own history, a kitchen's book accumulates for as long as the kitchen trades,
 * and the three questions staff actually ask it are "what is still open", "what
 * is going out on Thursday" and "where is order H360-…". `branch_id` is the
 * fourth: a two-branch kitchen wants one production site's day.
 *
 * `requested_delivery_date` matches on the day the food is wanted, **not** on
 * the day the order was taken. Those diverge by design — an order placed on
 * Monday for Friday is Friday's work — and a list keyed on the placement date
 * would show a kitchen the wrong day's production every time.
 *
 * `query` searches the **order number only**, and case-insensitively. Not the
 * customer's name, not the address: a staff-facing search across confidential
 * columns is how a directory of everybody a kitchen has ever delivered to gets
 * built one query at a time. The number is what is printed on the receipt in
 * the caller's hand.
 *
 * Served through the **kitchen** shape, which does carry `lock_version` — this
 * is the audience that writes, and a screen that could not read the validator
 * could not send the `If-Match` the lifecycle actions demand.
 */
final class KitchenOrderIndexController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderQuery $orders,
        private readonly OrderPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = $this->orders->forSeller($this->locator->sellerId());

        $this->applyStatus($request, $query);
        $this->applyRequestedDate($request, $query);
        $this->applyBranch($request, $query);
        $this->applySearch($request, $query);

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: true);

        $page = CursorPage::page($query->get(), $limit);
        $lines = $this->linesFor($page['items']->modelKeys());

        return ApiResponse::data(
            $page['items']->map(fn (Order $order): array => $this->presenter->kitchen(
                $order,
                $lines[(string) $order->getKey()] ?? [],
            ))->all(),
            $page['meta'],
        );
    }

    /**
     * Unlike the catalogue lists, an omitted `status` hides nothing. A retired
     * article is a row nobody should price by accident; a cancelled order is
     * part of the book, and a default that quietly dropped it would make every
     * total a kitchen reconciles against wrong.
     *
     * @param  Builder<Order>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            return;
        }

        if (! is_string($status) || OrderStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: placed, confirmed, fulfilled, cancelled.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
    }

    /**
     * @param  Builder<Order>  $query
     *
     * @throws ApiException
     */
    private function applyRequestedDate(Request $request, Builder $query): void
    {
        $date = $request->query('requested_delivery_date');

        if ($date === null || $date === '') {
            return;
        }

        // The exact shape, not merely something a date parser would accept:
        // "tomorrow" resolves happily and is a different day depending on when
        // the request lands, which is not a filter a kitchen can plan against.
        if (! is_string($date) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A requested delivery date is written YYYY-MM-DD.',
                ['parameter' => 'requested_delivery_date'],
            );
        }

        $query->whereDate('requested_delivery_date', $date);
    }

    /**
     * The branch comes from the query string here rather than from
     * `X-Branch-Id`, and deliberately: this is an organisation-wide book that
     * may be *narrowed* to one production site, not a branch-scoped endpoint.
     * A kitchen manager holding an organisation-wide membership selects no
     * branch at all, and an endpoint that read the header would show them
     * nothing until they picked one.
     *
     * @param  Builder<Order>  $query
     */
    private function applyBranch(Request $request, Builder $query): void
    {
        $branch = $request->query('branch_id');

        if (! is_string($branch) || $branch === '') {
            return;
        }

        $query->where('branch_id', $branch);
    }

    /**
     * @param  Builder<Order>  $query
     */
    private function applySearch(Request $request, Builder $query): void
    {
        $term = $request->query('query');

        if (! is_string($term) || trim($term) === '') {
            return;
        }

        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->whereRaw('lower(order_number) like ?', [$needle]);
    }

    /**
     * Every line of a whole page, in one statement, grouped by order.
     *
     * @param  array<int, int|string>  $orderIds
     * @return array<string, list<OrderLine>>
     */
    private function linesFor(array $orderIds): array
    {
        if ($orderIds === []) {
            return [];
        }

        $grouped = [];

        $rows = OrderLine::query()
            ->whereIn('order_id', $orderIds)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        foreach ($rows as $row) {
            $grouped[$row->order_id][] = $row;
        }

        return $grouped;
    }
}
