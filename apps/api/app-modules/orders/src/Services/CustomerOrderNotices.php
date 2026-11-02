<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Orders\Enums\CustomerOrderEvent;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Jobs\SendCustomerOrderNotice;
use Healthy360\Orders\Models\Order;
use Illuminate\Support\Facades\DB;
use Throwable;

use function Illuminate\Support\defer;

/**
 * Telling the customer where their order stands: the one call every step of an
 * order's life makes, and nothing here can stop that step.
 *
 * Nothing is sent until the transaction commits, so a refused or rolled-back
 * change tells nobody. Handed to the queue after the response for the reason
 * `QuotationNotices::send()` gives, and a queue that will not take it is reported
 * rather than thrown: a notice must never cost an order.
 *
 * **Who hears.** Anybody named on the order, guests included. A counter sale is
 * handed over in person, so it hears nothing, and only a delivery can be out for
 * delivery, delivered or failed: a pickup fulfilled at the counter is the customer
 * standing there.
 *
 * The job carries two identifiers and looks everything else up when it runs, so
 * no address, number or name sits in the queue.
 */
final readonly class CustomerOrderNotices
{
    public function send(Order $order, CustomerOrderEvent $event): void
    {
        if ($order->customer_account_id === null || $order->fulfilment_type === FulfilmentType::Counter) {
            return;
        }

        if ($event !== CustomerOrderEvent::Confirmed
            && $event !== CustomerOrderEvent::Cancelled
            && $order->fulfilment_type !== FulfilmentType::Delivery) {
            return;
        }

        $orderId = (string) $order->getKey();

        DB::afterCommit(static function () use ($orderId, $event): void {
            defer(static function () use ($orderId, $event): void {
                try {
                    SendCustomerOrderNotice::dispatch($orderId, $event->value);
                } catch (Throwable $e) {
                    report($e);
                }
            }, always: true);
        });
    }
}
