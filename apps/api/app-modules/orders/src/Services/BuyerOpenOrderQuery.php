<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\B2b\Contracts\SellerOpenOrders;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Illuminate\Database\Eloquent\Builder;

/**
 * B2's `SellerOpenOrders`, answered from the buyer's side of the book.
 *
 * **The name of the port is the seller's word for it and the query is the
 * buyer's**, which is exactly the confusion the port's own docblock warns
 * about. `OrderQuery::forSeller()` is the *kitchen's* book — orders the
 * organisation sold. That is not the question a wind-up asks. A corporate
 * customer being offboarded is a **buyer**, and its orders are the ones placed
 * against the `customer_accounts` row that belongs to it: `account_type = b2b`
 * with that `organisation_id`. Reading `orders.organisation_id` here would
 * return the food that organisation *sold*, which for a corporate customer is
 * nothing at all — a settlement check that always passes.
 *
 * `hasOpenOrders()` and `openOrderSummaries()` both walk that join, so a
 * company with two buying accounts (a head office and a site) is answered about
 * both.
 *
 * **`isAnswerable()` is true and that is the point of binding this.**
 * `NoSellerOpenOrders`, the default `B2bServiceProvider` registers with
 * `bindIf`, answers *false* so `SettlementRegistry` records `not_applicable`
 * with a reason rather than a green tick. Once this is bound the check becomes
 * real, and a wind-up with food in transit stops moving to sign-off.
 */
final readonly class BuyerOpenOrderQuery implements SellerOpenOrders
{
    public function hasOpenOrders(string $organisationId): bool
    {
        return $this->openOrders($organisationId)->exists();
    }

    /**
     * @return list<array{
     *     id: string,
     *     order_number: string,
     *     status: string,
     *     placed_at: string,
     *     requested_delivery_date: string|null
     * }>
     */
    public function openOrderSummaries(string $organisationId): array
    {
        $summaries = [];

        foreach ($this->openOrders($organisationId)->orderBy('placed_at')->get() as $order) {
            // Deliberately narrower than `OpenOrderQuery::openOrderSummaries()`,
            // which carries the money as well. A settlement screen names the
            // order and the day it is expected; what it cost is the company's
            // own commercial position and belongs on the order surface, behind
            // the order permission, rather than on a platform wind-up screen.
            $summaries[] = [
                'id' => (string) $order->getKey(),
                'order_number' => $order->order_number,
                'status' => $order->status->value,
                'placed_at' => $order->placed_at->toIso8601String(),
                'requested_delivery_date' => $order->requested_delivery_date?->toDateString(),
            ];
        }

        return $summaries;
    }

    public function isAnswerable(): bool
    {
        return true;
    }

    /**
     * Orders neither delivered nor cancelled, placed by any of this
     * organisation's buying accounts.
     *
     * @return Builder<Order>
     */
    private function openOrders(string $organisationId): Builder
    {
        return Order::query()
            ->whereIn('status', [OrderStatus::Placed->value, OrderStatus::Confirmed->value])
            ->whereIn('customer_account_id', CustomerAccount::query()
                ->where('organisation_id', $organisationId)
                ->where('account_type', CustomerAccountType::B2b->value)
                ->select('id'));
    }
}
