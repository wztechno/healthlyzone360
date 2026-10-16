<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

/**
 * "The driver has handed it over" — the delivery module telling orders that
 * the food reached the door (BUG-10).
 *
 * Until this existed the driver's Mark delivered moved only the delivery job,
 * so the order stayed `confirmed`: the customer kept seeing it on its way, and
 * the desk had to open it and press Mark fulfilled, which also receipted the
 * cash to whoever pressed it rather than to the driver who took it. The
 * handover is the moment the order is fulfilled, so the person who makes it is
 * the one who closes it.
 *
 * Declared here, beside `DeliveryJobProjection`, and answered by this module
 * (`DeliveredOrderFulfilment`): the delivery module already speaks to orders
 * through this namespace, and the write stays in the module that owns the
 * table.
 */
interface DeliveredOrderHandover
{
    /**
     * Fulfil the order behind a delivered job, as the person who delivered it.
     *
     * Called inside the delivery write's transaction. Does nothing for an order
     * that is already fulfilled or was cancelled — the driver's record of the
     * run stands either way, and the order's history is not rewritten.
     *
     * @param  string  $orderId  `delivery_jobs.order_id`
     */
    public function delivered(string $orderId): void;
}
