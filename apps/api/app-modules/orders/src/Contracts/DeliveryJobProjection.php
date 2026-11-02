<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

use Healthy360\Delivery\Enums\DeliveryFailureReason;
use Healthy360\Orders\Models\Order;
use Healthy360\Support\Api\Exceptions\ApiException;

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
 * **A cancelled order closes its run.** This used to be declined, on the ground
 * that calling a run off was a decision for the dispatch board. The live audit
 * reversed that: an order cancelled after Ready stayed on offer to drivers, and
 * one could collect food for a customer who had been told it was off. So
 * {@link cancel()} runs first inside the cancellation's own transaction. Nothing
 * is erased, the row stays as the record that a run existed, and food already on
 * the road refuses the cancellation rather than being called back by a column.
 *
 * **Fulfilment does reach the run (HA-29).** The kitchen can close a delivery
 * order by hand — the driver's phone died, a colleague drove it — and an order
 * the book calls delivered over a run still open is a driver claiming, picking
 * up and carrying food that has already arrived. {@see close()} marks the run
 * delivered in the fulfil's own transaction, and for the same reason: the run
 * ends where the order did. The one run it refuses is a failed one: food that came
 * back cannot be quietly marked delivered, and has to be sent out again first.
 *
 * **A run can come back.** {@link fail()} is the door nobody answered, and it
 * leaves the order `confirmed`. {@link reopen()} is the manager sending it out
 * again, and {@link handToCourier()} is a run leaving with somebody the kitchen
 * does not employ. All three are refused from the wrong state rather than ignored:
 * unlike a retried confirm, each is somebody asking for something to happen.
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
     * order that has none. Refuses a failed run, rolling the fulfil back.
     *
     * @throws ApiException `resource.conflict`
     */
    public function close(Order $order): void;

    /**
     * End this order's run because the order was cancelled, so no driver can
     * claim it or pick it up.
     *
     * A no-op for a run already closed, a failed one included, and for an order
     * that has none. Throws when the food is on the road, refusing the caller's
     * whole transaction: a run picked up and not closed ends as delivered or
     * failed, never cancelled.
     *
     * @throws ApiException `order.out_for_delivery`
     */
    public function cancel(Order $order): void;

    /**
     * The run came back: `failed`, off every sheet, with why. Only from `in_transit`.
     *
     * @throws ApiException `resource.conflict`
     */
    public function fail(Order $order, DeliveryFailureReason $reason, ?string $note): void;

    /**
     * Send a failed run out again: back to `pending` and `awaiting_assignment`,
     * with the driver, the pick-up, the failure and any courier cleared. Only from
     * `failed`. The order's `ready_at` stands, so drivers are offered it at once.
     *
     * @throws ApiException `resource.conflict`
     */
    public function reopen(Order $order): void;

    /**
     * A courier took the food: `in_transit`, picked up now, with no driver. Only
     * from a run nobody has picked up.
     *
     * @throws ApiException `resource.conflict`
     */
    public function handToCourier(Order $order, string $name, ?string $reference, ?int $feeMinor): void;
}
