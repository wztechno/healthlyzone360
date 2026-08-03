<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Contracts\SellerOpenOrders;

/**
 * The answer when no module can answer.
 *
 * **This is not "there are no open orders".** It returns no orders because it
 * has nowhere to look, and `isAnswerable()` returns false so that every caller
 * has to decide what to do with a non-answer. `SettlementRegistry` records
 * `not_applicable` with a reason rather than `clear`, which is the whole
 * difference between an honest settlement summary and one that shows a
 * permanently-green tick.
 *
 * The null default exists so the b2b module works with the orders module
 * removed — the same property `NullIngredientUsageRegistry` gives the
 * ingredients module — rather than as a placeholder waiting to be replaced.
 */
final readonly class NoSellerOpenOrders implements SellerOpenOrders
{
    public function hasOpenOrders(string $organisationId): bool
    {
        return false;
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
        return [];
    }

    public function isAnswerable(): bool
    {
        return false;
    }
}
