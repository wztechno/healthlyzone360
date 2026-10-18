<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

use Healthy360\Orders\Models\Order;

/**
 * The seam through which a confirmed delivery order becomes a job somebody has
 * to drive (C3).
 *
 * Orders declares the question; it never learns who answers it. The dependency
 * edge already runs the other way — Orders → Delivery, because placement
 * resolves a zone fee through `ZoneResolver` — so orders reaching into the
 * delivery module to insert a row would make the coupling mutual and put the
 * *writing* of another module's table inside this one. Instead this is an
 * ordinary port, the third on this module and the second of its shape: orders
 * states what it needs at the one lifecycle chokepoint that produces the fact,
 * `OrdersServiceProvider` binds a null default so an order still confirms with
 * no delivery module present, and the delivery module binds the real
 * implementation over that default from its own `boot()`
 * (`OrderStockConsumption` is the template, one file over).
 *
 * **A job is a confirmation decision, not a placement one.** It is created on
 * `OrderLifecycle::confirm()` — the moment a kitchen commits to cook, and
 * therefore the first moment anybody can honestly say the food is going to
 * travel — and only for `FulfilmentType::Delivery`. A placed order may still be
 * cancelled without a driver ever hearing about it, and a pickup or counter sale
 * has nowhere to be driven to.
 *
 * **The projection is idempotent by contract.** Confirming an order whose job
 * already exists must not create a second one, because the `$within` closure
 * this runs inside can re-run on a retried confirm — a lost-update retry or a
 * re-delivered request is an ordinary Tuesday — and two jobs for one order is
 * two drivers at one door. The delivery module's implementation leans on the
 * unique index on `delivery_jobs.order_id` rather than on a read-then-write,
 * which is the only version of the guarantee that survives concurrency.
 *
 * **There is deliberately no reverse.** `cancel()` calls nothing here, unlike
 * `OrderStockConsumption::restore()`: stock is a quantity that must balance, and
 * a delivery job is a *record of work* whose own status lifecycle belongs to the
 * delivery module. A cancelled order keeps its job row, and cancelling the run
 * is a dispatch decision made on the dispatch board — deleting it from under
 * that board would erase the fact that a driver was once sent.
 *
 * **Fulfilment does reach the run (HA-29).** The kitchen can close a delivery
 * order by hand — the driver's phone died, a colleague drove it — and an order
 * the book calls delivered over a run still open is a driver claiming, picking
 * up and carrying food that has already arrived. {@see close()} marks the run
 * delivered in the fulfil's own transaction. It is not the reverse the
 * paragraph above declines: nothing is erased, the run simply ends where the
 * order did.
 */
interface DeliveryJobProjection
{
    /**
     * Create the delivery job this order needs, if it does not already have one.
     *
     * Idempotent: a no-op when a job for this order already exists. Never throws
     * for a job that is already there — that is the expected outcome of a retry,
     * not a fault.
     */
    public function project(Order $order): void;

    /**
     * End this order's run because the order was fulfilled, so it leaves every
     * driver's sheet and can no longer be claimed or picked up.
     *
     * A no-op for a run already delivered or cancelled — the driver's own
     * Mark delivered reaches here after it has closed the run — and for an
     * order that has none.
     */
    public function close(Order $order): void;
}
