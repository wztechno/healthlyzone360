<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\OrderDesk\Services\OrderDeskQueue;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderAmendability;
use Healthy360\Orders\Services\OrderDeliveryRuns;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\UnacceptedOrderClock;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * GET /api/v1/catalogue/kitchen-display — every open ticket, for the wall.
 *
 * **Why not the order book.** `GET /catalogue/orders` is newest first and paged,
 * so a board reading its first page lost the oldest tickets past 25 open orders,
 * and the oldest ticket is the one that needs starting.
 *
 * **Capped rather than paged, and it says so**, on `OrderDeskQueue`'s argument:
 * a wall has no page two. Open work sorts ahead of finished work, so what the cap
 * cuts first is a receipt rather than a ticket.
 *
 * **Finished work is the last 24 hours**, a window every "today" falls inside
 * wherever the screen is. Which of it counts as today is `kds-board.ts`'s rule,
 * read on the screen's own clock, as the branch rule is: `branch_id` is null on an
 * order delivered through an organisation-wide zone, so filtering here would
 * delete the work.
 *
 * **It carries the waiting time**, in minutes while open, so the client never
 * works out opening hours. Polled every few seconds: the branch hours are read
 * once for the whole response ({@see UnacceptedOrderClock}), and the presenter's
 * allergy read is audited once a day per reader and order, not per poll.
 *
 * **Two audiences.** `order.view_organisation` reads the order book anyway, so it
 * gets the ticket as it stands. A cook on `order.prepare_organisation` alone gets
 * the same ticket with the money and the street address taken off, because the
 * chef and the cook read no price on any other surface and a wall needs neither.
 * Allergies stay: they are what the cook is standing there to read.
 */
final class KitchenDisplayController
{
    public const int MAX_ORDERS = 500;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderPresenter $presenter,
        private readonly OrderDeliveryRuns $runs,
        private readonly OrderAmendability $amendability,
        private readonly UnacceptedOrderClock $clock,
        private readonly KitchenServiceSettingsLookup $settings,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(): JsonResponse
    {
        $organisationId = $this->locator->sellerId();
        $now = CarbonImmutable::now();

        // The desk queue's due instant, on the same `dw` and `b` joins, so the wall
        // sorts by when an order is due rather than when it arrived. Columns are
        // qualified because both joins bring an `id`, an `organisation_id` and a status.
        $rows = Order::query()
            ->select('orders.*')
            ->selectRaw(OrderDeskQueue::DUE_AT.' as due_at')
            ->leftJoin('delivery_windows as dw', static function (JoinClause $join): void {
                $join->on('dw.organisation_id', '=', 'orders.organisation_id')
                    ->on('dw.code', '=', 'orders.delivery_window_code');
            })
            ->leftJoin('organisation_branches as b', 'b.id', '=', 'orders.branch_id')
            ->where('orders.organisation_id', $organisationId)
            ->where(static function (Builder $board) use ($now): void {
                $board->whereIn('orders.status', [OrderStatus::Placed->value, OrderStatus::Confirmed->value])
                    ->orWhere(static function (Builder $finished) use ($now): void {
                        $finished->where('orders.status', OrderStatus::Fulfilled->value)
                            ->where('orders.fulfilled_at', '>=', $now->subDay());
                    });
            })
            ->orderByRaw('orders.status = ? asc', [OrderStatus::Fulfilled->value])
            ->orderBy('orders.placed_at')
            ->orderBy('orders.id')
            ->limit(self::MAX_ORDERS + 1)
            ->with('deliveryZone')
            ->get();

        $orders = $rows->take(self::MAX_ORDERS);
        $orderIds = array_values(array_map('strval', $orders->modelKeys()));

        /** @var array<string, list<OrderLine>> $lines */
        $lines = OrderLine::query()
            ->whereIn('order_id', $orderIds)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->groupBy('order_id')
            ->map(static fn ($group): array => $group->all())
            ->all();

        $runs = $this->runs->forOrders($orderIds);
        $amendable = $this->amendability->reasons($orders, $lines);
        $this->presenter->preloadPlanDays($orderIds);
        $this->presenter->preloadRemakes($orderIds);
        $readsTheBook = Gate::allows('order.view_organisation');

        return ApiResponse::data([
            'orders' => $orders->map(function (Order $order) use ($lines, $runs, $amendable, $readsTheBook): array {
                $ticket = $this->presenter->kitchen(
                    $order,
                    $lines[(string) $order->getKey()] ?? [],
                    $runs[(string) $order->getKey()] ?? null,
                    ($amendable[(string) $order->getKey()] ?? null) === null,
                );

                // A `timestamptz` in the session zone; the wire carries UTC, as the desk queue's does.
                // Empty falls back to when it was placed, as `OrderDeskQueue::instant()` does, never "now".
                $due = $order->getAttribute('due_at');
                $ticket['due_at'] = is_string($due) && $due !== ''
                    ? CarbonImmutable::parse($due)->utc()->toIso8601String()
                    : $order->placed_at->utc()->toIso8601String();

                return $readsTheBook ? $ticket : $this->presenter->forTheLine($ticket);
            })->all(),
            'truncated' => $rows->count() > self::MAX_ORDERS,
            'alarm_after_minutes' => $this->settings->for($organisationId)->alarm_after_minutes,
            // An object even when empty: `[]` on the wire would be a list.
            'unaccepted_open_minutes' => (object) $this->clock->openMinutes($organisationId, $orders, $now),
        ]);
    }
}
