<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

use Healthy360\Orders\Models\Order;

/**
 * The seam through which a confirmed order takes ingredients off the shelf, and
 * a cancelled one puts them back (INV1.2).
 *
 * Orders declares the question; it never learns who answers it. The dependency
 * edge the module registry asserts runs *toward* orders — Inventory → Orders —
 * so a reverse call, orders reaching into inventory, would be the cycle the
 * architecture test forbids. Instead this is an ordinary port: orders states
 * what it needs at the two lifecycle chokepoints, `OrdersServiceProvider` binds
 * a null default so an order still confirms with no inventory module present,
 * and the inventory module binds the real implementation over that default from
 * its own `boot()` (the `IngredientUsageRegistry` precedent, one module family
 * over).
 *
 * **Deduction is a kitchen decision, not a placement one.** It happens on
 * `OrderLifecycle::confirm()` — the moment a kitchen commits to cook — and is
 * reversed on `cancel()`. Both operations are idempotent by contract: confirming
 * or cancelling an order whose stock has already moved must not move it a second
 * time, because a lost-update retry or a re-delivered event is an ordinary
 * Tuesday and a double deduction is a wrong balance nobody can explain.
 *
 * **Neither method throws for a data problem it can describe.** A meal with no
 * resolvable recipe, an ingredient with no stock item at the branch, units that
 * cannot convert — none of these blocks the confirm. The implementation deducts
 * what it can resolve and records an unresolved-consumption exception the
 * kitchen can read; it never guesses a quantity and never fails a confirmed
 * order over stock arithmetic.
 */
interface OrderStockConsumption
{
    /**
     * Deduct the ingredients this order's lines consume, valuing each deduction
     * at the ingredient's moving-average cost (COGS). Idempotent: a no-op if the
     * order's consumption movements already exist.
     */
    public function consume(Order $order): void;

    /**
     * Put back exactly what {@see consume()} removed. Idempotent: a no-op if the
     * order was never consumed, or has already been restored.
     */
    public function restore(Order $order): void;
}
