<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

use Healthy360\Delivery\Enums\DeliveryFailureReason;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Validation\ValidationException;

/**
 * "The driver has handed it over" — the delivery module telling orders that
 * the food reached the door (BUG-10).
 *
 * Until this existed the driver's Mark delivered moved only the delivery job,
 * so the order stayed `confirmed`: the customer kept seeing it on its way, and
 * the desk had to open it and press Mark fulfilled. The handover is the moment
 * the order is fulfilled, so the person who makes it is the one who closes it,
 * and the one who says how much cash they took.
 *
 * Declared here, beside `DeliveryJobProjection`, and answered by this module
 * (`DeliveredOrderFulfilment`): the delivery module already speaks to orders
 * through this namespace, and the write stays in the module that owns the
 * table.
 */
interface DeliveredOrderHandover
{
    /**
     * Fulfil the order behind a delivered job, as the person who delivered it,
     * and receipt the cash they say they took.
     *
     * Called inside the delivery write's transaction, so a refusal rolls the job
     * back too. Does nothing for an order that is already fulfilled or was
     * cancelled: the driver's record of the run stands either way, and the
     * order's history is not rewritten. Writes no receipt for a WISH order, whose
     * amount is ignored.
     *
     * @param  string  $orderId  `delivery_jobs.order_id`
     * @param  int|null  $collectedMinor  what the driver took; required on a cash order
     * @param  string|null  $note  why, when that is nothing
     *
     * @throws ValidationException when the amount cannot be true
     */
    public function delivered(string $orderId, string $driverUserId, ?int $collectedMinor, ?string $note): void;

    /**
     * The driver could not hand it over. The order stays `confirmed` and the
     * managers are alerted.
     *
     * @param  string  $orderId  `delivery_jobs.order_id`
     *
     * @throws ApiException when the run is not on the road
     */
    public function failed(string $orderId, DeliveryFailureReason $reason, ?string $note): void;
}
