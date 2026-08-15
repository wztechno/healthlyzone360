<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Orders\Contracts\OpenOrderQuery;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Illuminate\Database\Eloquent\Builder;

/**
 * Reading orders, with the scope always stated.
 *
 * `orders` carries no PostgreSQL policy and no global Eloquent scope — the row
 * belongs to a customer who is a member of no organisation, so an ambient
 * organisation scope would hide an order from the person who placed it. That
 * decision moves the burden here: every read goes through a method that names
 * whose orders it wants, and there is no method that forgets to. A caller
 * cannot accidentally write `Order::query()->get()` in this module and get
 * everybody's, because nothing in this module offers that.
 *
 * The two audiences are genuinely different questions.
 * `forSeller()` is a kitchen looking at its own book; `forCustomer()` is a
 * person looking at their own orders. Neither is a filter on the other.
 */
final readonly class OrderQuery implements OpenOrderQuery
{
    /**
     * One kitchen's orders. The organisation filter is the isolation boundary
     * for this table, so it is applied here rather than being left to the
     * caller.
     *
     * @return Builder<Order>
     */
    public function forSeller(string $organisationId): Builder
    {
        return Order::query()->where('organisation_id', $organisationId);
    }

    /**
     * One customer's orders, newest first — the order-history shape.
     *
     * @return Builder<Order>
     */
    public function forCustomer(string $customerAccountId): Builder
    {
        return Order::query()
            ->where('customer_account_id', $customerAccountId)
            ->orderByDesc('placed_at');
    }

    public function hasOpenOrders(string $customerAccountId): bool
    {
        return $this->openOrders($customerAccountId)->exists();
    }

    /**
     * @return list<array{
     *     id: string,
     *     order_number: string,
     *     status: string,
     *     placed_at: string,
     *     requested_delivery_date: string|null,
     *     total_minor: int,
     *     currency_code: string
     * }>
     */
    public function openOrderSummaries(string $customerAccountId): array
    {
        $summaries = [];

        foreach ($this->openOrders($customerAccountId)->orderBy('placed_at')->get() as $order) {
            $summaries[] = [
                'id' => (string) $order->getKey(),
                'order_number' => $order->order_number,
                'status' => $order->status->value,
                'placed_at' => $order->placed_at->toIso8601String(),
                'requested_delivery_date' => $order->requested_delivery_date?->toDateString(),
                'total_minor' => $order->total_minor,
                'currency_code' => $order->currency_code,
            ];
        }

        return $summaries;
    }

    /**
     * Neither delivered nor cancelled. Derived from the enum rather than from
     * a repeated `whereIn`, so a fifth status could not quietly become
     * "closed" by being left out of a list somewhere.
     *
     * @return Builder<Order>
     */
    private function openOrders(string $customerAccountId): Builder
    {
        $open = array_values(array_map(
            static fn (OrderStatus $status): string => $status->value,
            array_filter(OrderStatus::cases(), static fn (OrderStatus $status): bool => $status->isOpen()),
        ));

        return Order::query()
            ->where('customer_account_id', $customerAccountId)
            ->whereIn('status', $open);
    }
}
