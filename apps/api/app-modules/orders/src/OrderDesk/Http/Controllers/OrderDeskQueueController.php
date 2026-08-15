<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\OrderDesk\Enums\OrderDeskWindow;
use Healthy360\Orders\OrderDesk\Presenters\OrderDeskPresenter;
use Healthy360\Orders\OrderDesk\Services\OrderDeskQueue;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/catalogue/order-desk/queue — the open book in the order it has
 * to be worked.
 *
 * **Not a second order index.** `GET /catalogue/orders` is the kitchen's whole
 * book, newest first, walked with a cursor: the surface for "what did we do
 * last Tuesday" and "where is order H360-…". This is the surface for "what is
 * next", which is a different sort and therefore a different endpoint. The two
 * could not be one: the due order is a computed expression across three tables,
 * and `CursorPage` re-sorts everything it constrains, so a cursor and this
 * ordering cannot both be true of the same query.
 *
 * **Bounded rather than paginated, and it says so.** Two hundred rows, with
 * `meta.truncated` when more matched. A desk queue is a list somebody works
 * through, not a corpus somebody browses; if a kitchen has more than two
 * hundred open orders in a window the honest answer is to say so on the screen,
 * not to hand out page two.
 *
 * **`order.view_organisation`** — the same read the order book is behind, and
 * deliberately not a new one. Seeing the day's work in a useful order is not a
 * greater authority than seeing it in a useless one. The *contact* fields are a
 * greater authority, and they have their own code:
 * `order.view_customer_contact_organisation`, resolved here and passed to the
 * presenter as a boolean so that nothing below this line has to ask who is
 * calling. Without it, the queue is served in full and the `customer` key is
 * simply absent.
 *
 * **`branch_id` is a query parameter, not `X-Branch-Id`**, on
 * `KitchenOrderIndexController`'s argument: this is an organisation-wide book
 * that may be *narrowed* to one production site, and a manager holding an
 * organisation-wide membership selects no branch. It does a second job here
 * that it does not do there — it names the clock "today" is read on, because a
 * branch is a place and a place has a working day. Unnamed, the day boundary is
 * UTC, which is the only zone that is not a guess.
 */
final class OrderDeskQueueController
{
    /**
     * The code that adds two fields to a row and nothing else.
     */
    private const string CONTACT_PERMISSION = 'order.view_customer_contact_organisation';

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderDeskQueue $queue,
        private readonly OrderDeskPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'window' => ['nullable', Rule::in(OrderDeskWindow::codes())],
            'branch_id' => ['nullable', 'uuid'],
            'status' => ['nullable', 'array'],
            'status.*' => ['string', Rule::in(array_map(
                static fn (OrderStatus $status): string => $status->value,
                OrderDeskQueue::openStatuses(),
            ))],
            'delivery_window_code' => ['nullable', 'string', 'max:40'],
            'query' => ['nullable', 'string', 'max:60'],
        ]);

        $page = $this->queue->forSeller(
            $this->locator->sellerId(),
            OrderDeskWindow::from((string) ($validated['window'] ?? OrderDeskWindow::Today->value)),
            isset($validated['branch_id']) ? (string) $validated['branch_id'] : null,
            $this->statuses($validated['status'] ?? null),
            isset($validated['delivery_window_code']) ? (string) $validated['delivery_window_code'] : null,
            isset($validated['query']) ? (string) $validated['query'] : null,
        );

        $orders = $page['orders'];
        $lines = $this->linesFor(array_map(static fn (Order $order): string => (string) $order->getKey(), $orders));

        // Resolved once for the whole page rather than per row, and only when
        // it will be spent: an unpermitted caller never causes the confidential
        // columns to be read at all.
        $includeContact = Gate::allows(self::CONTACT_PERMISSION);

        $contacts = $includeContact
            ? $this->queue->contactsFor(array_map(static fn (Order $order): string => (string) $order->customer_account_id, $orders))
            : [];

        $rows = [];

        foreach ($orders as $order) {
            $id = (string) $order->getKey();

            $rows[] = $this->presenter->row(
                $order,
                $lines[$id] ?? [],
                $page['due_at'][$id] ?? $order->placed_at->utc()->toIso8601String(),
                $includeContact,
                $contacts[(string) $order->customer_account_id] ?? null,
            );
        }

        return ApiResponse::data($rows, [
            'count' => count($rows),
            // Two facts, not one. `limit` is what the server will ever return
            // and `truncated` is whether it hit that, so a screen can say
            // "the first 200 of more" rather than inventing the sentence from a
            // count it cannot interpret.
            'limit' => OrderDeskQueue::MAX_ROWS,
            'truncated' => $page['truncated'],
            'window' => (string) ($validated['window'] ?? OrderDeskWindow::Today->value),
            // Echoed because the client did not choose them and cannot derive
            // them: which day the window was measured from, and on whose clock.
            'today' => $page['today'],
            'timezone' => $page['timezone'],
        ]);
    }

    /**
     * The requested statuses as enum cases, or null for the queue's own default
     * of "everything still moving".
     *
     * @return list<OrderStatus>|null
     */
    private function statuses(mixed $statuses): ?array
    {
        if (! is_array($statuses) || $statuses === []) {
            return null;
        }

        $cases = [];

        foreach ($statuses as $status) {
            $case = is_string($status) ? OrderStatus::tryFrom($status) : null;

            // Unreachable behind the validator, and present so that a rule
            // relaxed later fails closed rather than widening the queue past
            // the two statuses it exists to show.
            if ($case !== null && in_array($case, OrderDeskQueue::openStatuses(), true)) {
                $cases[] = $case;
            }
        }

        return $cases === [] ? null : array_values(array_unique($cases, SORT_REGULAR));
    }

    /**
     * Every line of the whole queue, in one statement, grouped by order — the
     * batching `KitchenOrderIndexController` does, and it matters more here:
     * two hundred rows is two hundred round trips if this is got wrong.
     *
     * @param  list<string>  $orderIds
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
