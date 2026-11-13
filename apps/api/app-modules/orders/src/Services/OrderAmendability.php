<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Illuminate\Support\Facades\DB;

/**
 * Whether the Order Desk may still edit an order, and if not, why.
 *
 * One answer for two callers: `OrderPlacementService::amend()` refuses with it
 * (`order_not_amendable` carrying `because`), and `OrderPresenter::kitchen()`
 * serves its negation as `amendable`, so the button a screen shows and the edit
 * the server accepts cannot disagree.
 *
 * The reasons, in the order they are asked:
 *
 *  * `closed` — not `placed` and not `confirmed`.
 *  * `kitchen_started` — the kitchen pressed Start (`preparing_at`).
 *  * `ready` — the kitchen marked it ready (`ready_at`).
 *  * `agreement_priced` — a line was priced by a subscription or a quotation
 *    (`price_source`); repricing it on the tariff would break that agreement.
 *  * `other_channel` — sold through anything but the desk (`pos`) or the web
 *    shop (`b2c_web`).
 *  * `paid_online` — a `payment_intents` row exists; a captured amount cannot be
 *    re-cut from here.
 *  * `legacy_consumption` — confirmed, and its stock came off the shelf before
 *    deductions carried their order line, so it cannot be released line by line.
 */
final readonly class OrderAmendability
{
    /** @var list<SalesChannelKind> */
    private const array EDITABLE_CHANNEL_KINDS = [SalesChannelKind::Pos, SalesChannelKind::B2cWeb];

    public function __construct(private OrderStockConsumption $consumption) {}

    /**
     * @param  iterable<int, OrderLine>|null  $lines  the order's lines, when the caller already holds them
     */
    public function reason(Order $order, ?iterable $lines = null): ?string
    {
        $id = (string) $order->getKey();

        return $this->reasons([$order], [$id => $lines ?? $order->lines()->get()])[$id];
    }

    /**
     * The same answer for a page of orders, in a fixed number of queries
     * whatever the page size — the kitchen book and the desk queue serve this on
     * every row.
     *
     * @param  iterable<int, Order>  $orders
     * @param  array<string, iterable<int, OrderLine>>  $linesByOrder
     * @return array<string, string|null> keyed by order id
     */
    public function reasons(iterable $orders, array $linesByOrder): array
    {
        $reasons = [];
        $open = [];

        foreach ($orders as $order) {
            $id = (string) $order->getKey();
            $reasons[$id] = $this->stateReason($order, $linesByOrder[$id] ?? []);

            if ($reasons[$id] === null) {
                $open[$id] = $order;
            }
        }

        if ($open === []) {
            return $reasons;
        }

        $kinds = SalesChannel::withoutTenancy()
            ->whereKey(array_values(array_unique(array_map(static fn (Order $order): string => (string) $order->sales_channel_id, $open))))
            ->get(['id', 'channel_kind'])
            ->mapWithKeys(static fn (SalesChannel $channel): array => [(string) $channel->getKey() => $channel->channel_kind])
            ->all();

        $paidOnline = array_flip(DB::table('payment_intents')
            ->whereIn('order_id', array_keys($open))
            ->distinct()
            ->pluck('order_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());

        foreach ($open as $id => $order) {
            if (! in_array($kinds[(string) $order->sales_channel_id] ?? null, self::EDITABLE_CHANNEL_KINDS, true)) {
                $reasons[$id] = 'other_channel';
            } elseif (isset($paidOnline[$id])) {
                $reasons[$id] = 'paid_online';
            } elseif ($order->status === OrderStatus::Confirmed && $this->consumption->hasUnattributedConsumption($order)) {
                // ponytail: one query per open confirmed order; batch through the port if a page ever gets long.
                $reasons[$id] = 'legacy_consumption';
            }
        }

        return $reasons;
    }

    /**
     * @param  iterable<int, OrderLine>  $lines
     */
    private function stateReason(Order $order, iterable $lines): ?string
    {
        if ($order->status !== OrderStatus::Placed && $order->status !== OrderStatus::Confirmed) {
            return 'closed';
        }

        if ($order->preparing_at !== null) {
            return 'kitchen_started';
        }

        if ($order->ready_at !== null) {
            return 'ready';
        }

        foreach ($lines as $line) {
            if ($line->price_source !== null) {
                return 'agreement_priced';
            }
        }

        return null;
    }
}
