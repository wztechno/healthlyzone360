<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderAmendability;
use Healthy360\Orders\Services\OrderDeliveryRuns;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\OrderQuery;
use Healthy360\Orders\Services\UnacceptedOrderClock;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;

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
 */
final class KitchenDisplayController
{
    public const int MAX_ORDERS = 500;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderQuery $orders,
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

        $rows = $this->orders->forSeller($organisationId)
            ->where(static function (Builder $board) use ($now): void {
                $board->whereIn('status', [OrderStatus::Placed->value, OrderStatus::Confirmed->value])
                    ->orWhere(static function (Builder $finished) use ($now): void {
                        $finished->where('status', OrderStatus::Fulfilled->value)
                            ->where('fulfilled_at', '>=', $now->subDay());
                    });
            })
            ->orderByRaw('status = ? asc', [OrderStatus::Fulfilled->value])
            ->orderBy('placed_at')
            ->orderBy('id')
            ->limit(self::MAX_ORDERS + 1)
            ->with('deliveryZone')
            ->get();

        $orders = $rows->take(self::MAX_ORDERS);
        $orderIds = array_map('strval', $orders->modelKeys());

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

        return ApiResponse::data([
            'orders' => $orders->map(fn (Order $order): array => $this->presenter->kitchen(
                $order,
                $lines[(string) $order->getKey()] ?? [],
                $runs[(string) $order->getKey()] ?? null,
                ($amendable[(string) $order->getKey()] ?? null) === null,
            ))->all(),
            'truncated' => $rows->count() > self::MAX_ORDERS,
            'alarm_after_minutes' => $this->settings->for($organisationId)->alarm_after_minutes,
            // An object even when empty: `[]` on the wire would be a list.
            'unaccepted_open_minutes' => (object) $this->clock->openMinutes($organisationId, $orders, $now),
        ]);
    }
}
