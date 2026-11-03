<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderDeliveryRuns;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\SellerContext;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/me/orders/{order}/cancel — the customer calls off their own order.
 *
 * **Only while it is `placed`.** Once the kitchen accepts, stock is deducted and
 * cooking may start, so after that the customer contacts the kitchen. Payment is
 * cash on delivery: nothing is refunded because nothing was taken.
 *
 * **Exactly one of accept and cancel wins.** The cancel runs at the lock version
 * this request read, and `OrderLifecycle::transition()` writes only while status
 * and lock are both unchanged. An accept that lands between the read and the
 * write turns this into the same `409 order_already_accepted` a late cancel gets.
 * No `If-Match`: the customer is never served a validator (`MyOrderShowController`).
 *
 * Found as `MyOrderShowController` finds it, so somebody else's order is a 404.
 * The lifecycle runs in the seller's context, as placement does, because the
 * stock and portions it releases are the kitchen's rows.
 */
final class MyOrderCancelController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderLifecycle $lifecycle,
        private readonly SellerContext $seller,
        private readonly OrderPresenter $presenter,
        private readonly OrderDeliveryRuns $runs,
        private readonly StaffAlerts $alerts,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $order): JsonResponse
    {
        $account = $this->locator->shopper();
        $record = $this->locator->customerOrder($account, $order);

        if ($record->status !== OrderStatus::Placed) {
            throw $this->alreadyAccepted();
        }

        try {
            $cancelled = $this->seller->during(
                $record->organisation_id,
                $record->branch_id,
                fn (): Order => $this->lifecycle->cancel($record, CancellationReason::CustomerRequested, $record->lock_version),
            );
        } catch (ApiException $e) {
            if ($e->errorCode !== ErrorCode::ResourceConflict) {
                throw $e;
            }

            throw $this->alreadyAccepted($e);
        }

        $this->alerts->send(StaffAlertType::CustomerCancelled, $cancelled->organisation_id, (string) $cancelled->getKey(), [
            'order_number' => $cancelled->order_number,
        ]);

        $lines = $cancelled->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->customer($cancelled, $lines, $this->runs->forOrder((string) $cancelled->getKey()))]);
    }

    private function alreadyAccepted(?ApiException $previous = null): ApiException
    {
        return new ApiException(
            ErrorCode::ResourceConflict,
            'The kitchen has already accepted this order. Contact the kitchen to change it.',
            ['reason' => 'order_already_accepted'],
            previous: $previous,
        );
    }
}
