<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

/**
 * "Does this customer have anything in flight?"
 *
 * Declared as a port because of who asks it. J2 closes and anonymises customer
 * accounts, and an account with an undelivered order may not be closed — food
 * is on its way to an address that is about to be scrubbed. The closure
 * journey needs that one fact and nothing else about orders: not the lines,
 * not the totals, not the delivery terms. An interface with two methods is
 * what keeps a closure service from growing a dependency on the whole order
 * model, and what lets closure be tested against a stub instead of a placed
 * order.
 *
 * Bound to `OrderQuery` in `OrdersServiceProvider`.
 */
interface OpenOrderQuery
{
    /**
     * Whether the customer has an order that is neither delivered nor
     * cancelled — the blocking condition for closure.
     */
    public function hasOpenOrders(string $customerAccountId): bool;

    /**
     * The open orders, in enough detail to tell somebody why they cannot close
     * their account yet, and no more.
     *
     * Deliberately not the orders themselves. A closure screen needs to say
     * "order H360-XXXX, placed on Tuesday, arriving Thursday"; handing it
     * models would let it render an address it has no reason to read.
     *
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
    public function openOrderSummaries(string $customerAccountId): array;
}
