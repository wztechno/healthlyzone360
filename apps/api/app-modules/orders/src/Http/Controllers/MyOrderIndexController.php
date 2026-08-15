<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\OrderQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/orders — one person's order history, newest first.
 *
 * **Newest first, and the direction is a property of the endpoint rather than
 * a query parameter.** Order history is read from the top: the order somebody
 * has a question about is almost always the last one. A collection that could
 * be walked both ways from one cursor would need the direction inside the
 * cursor to stay coherent, so `CursorPage` takes it as an argument and no
 * client may ask for the other.
 *
 * **No filters, deliberately.** A `status` filter is the obvious next thing to
 * want and is absent: a person has tens of orders, not thousands, the whole
 * history fits in a page or two, and a parameter to document, version and test
 * in exchange for saving a client one array filter is a bad trade. The kitchen
 * list reads a book that grows without limit and has three; that asymmetry is
 * the point rather than an inconsistency.
 *
 * **The lines come with each order**, because an order history that showed only
 * totals would send a client back once per row to render the one thing a person
 * actually recognises — the names of the food. They are fetched in **one**
 * query for the whole page and grouped in memory: a per-order read here is the
 * N+1 that turns a twenty-five-row page into fifty round trips.
 *
 * Served through the **customer** shape, which carries no price-list
 * provenance, no `organisation_id`, no `created_by` and no `lock_version` —
 * see `OrderPresenter` for what each exclusion costs and why it is paid.
 */
final class MyOrderIndexController
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
        $account = $this->locator->shopper();

        $query = $this->orders->forCustomer((string) $account->getKey());

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: true);

        $page = CursorPage::page($query->get(), $limit);
        $lines = $this->linesFor($page['items']->modelKeys());

        return ApiResponse::data(
            $page['items']->map(fn (Order $order): array => $this->presenter->customer(
                $order,
                $lines[(string) $order->getKey()] ?? [],
            ))->all(),
            $page['meta'],
        );
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
