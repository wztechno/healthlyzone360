<?php

declare(strict_types=1);

namespace Healthy360\B2b\Contracts;

/**
 * "Does this organisation still have anything in flight as a buyer?"
 *
 * A settlement check cannot end a corporate relationship while food is on its
 * way to that company's offices, so the offboarding service needs this one
 * fact. The orders module already publishes `OpenOrderQuery`, and it is the
 * wrong shape for the question: it is keyed on a **customer account**, which
 * is what a D2C closure asks about. A corporate buyer's orders are found by
 * organisation, and `OrderQuery::forSeller()` — the only organisation-keyed
 * reader that exists — means the *kitchen's* book, not the buyer's.
 *
 * So B2 declares its own port rather than bending an existing one. The
 * direction is the same as every other port in the platform: the module that
 * needs the answer declares the question, and whichever module can answer it
 * binds an implementation. `NoSellerOpenOrders` is the default, and it is
 * honest rather than convenient — see its own docblock for why an absent
 * implementation must not answer "nothing outstanding".
 *
 * **For integrator-2.** The orders module implements this over
 * `orders.organisation_id`-independent buyer identity: a corporate buyer's
 * orders are the ones whose `customer_account_id` belongs to a
 * `customer_accounts` row with `account_type = 'b2b'` and this
 * `organisation_id`. Bind it in `OrdersServiceProvider`, replacing the null
 * default registered in `B2bServiceProvider`.
 */
interface SellerOpenOrders
{
    /**
     * Whether this organisation, as a buyer, has an order that is neither
     * delivered nor cancelled.
     */
    public function hasOpenOrders(string $organisationId): bool;

    /**
     * The open orders in enough detail to tell somebody why the relationship
     * cannot be wound up yet, and no more.
     *
     * Deliberately not the orders themselves, for the reason
     * `OpenOrderQuery::openOrderSummaries()` gives: a settlement screen needs
     * to name an order and a date, and handing it models would let it render
     * a delivery address it has no reason to read.
     *
     * @return list<array{
     *     id: string,
     *     order_number: string,
     *     status: string,
     *     placed_at: string,
     *     requested_delivery_date: string|null
     * }>
     */
    public function openOrderSummaries(string $organisationId): array;

    /**
     * Whether an implementation backed by a real orders module answered.
     *
     * The one method a plain query port would not have, and the reason it is
     * here is `SettlementRegistry`: a check that cannot tell "we looked and
     * found nothing" from "nobody was there to look" produces a settlement
     * summary that reads as an all-clear when it is a gap. The registry asks
     * this so it can record `not_applicable` with a reason instead of `clear`.
     */
    public function isAnswerable(): bool;
}
