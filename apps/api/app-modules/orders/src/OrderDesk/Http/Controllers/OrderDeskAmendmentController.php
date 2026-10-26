<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Http\Concerns\ReadsPrecondition;
use Healthy360\Orders\OrderDesk\Http\Concerns\ResolvesDeskParty;
use Healthy360\Orders\OrderDesk\Http\Requests\AmendOrderDeskOrderRequest;
use Healthy360\Orders\OrderDesk\Services\DeskBasket;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderAmendment;
use Healthy360\Orders\Services\OrderDeliveryRuns;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/order-desk/orders/{order} — a customer rang back.
 *
 * Changes the lines, and optionally the address, the day and slot, and how it
 * will be paid, of an order still `placed` or `confirmed` that the kitchen has
 * not started or finished. `OrderPlacementService::amend()` holds the rules;
 * this is the HTTP shape around it.
 *
 * `order.create_on_behalf_organisation`, the code that places a desk sale: an
 * edit re-decides what the customer is owed exactly as a placement decides it.
 *
 * **`If-Match` is the replay guard** — no `Idempotency-Key`. A replayed edit
 * carries the old validator and is a `409`, which is the answer a duplicate
 * needs. The new address, when one is named, must be the order's own
 * customer's: `ResolvesDeskParty` answers anything else `404`.
 */
final class OrderDeskAmendmentController
{
    use ReadsPrecondition;
    use ResolvesDeskParty;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskBasket $basket,
        private readonly OrderPlacementService $placement,
        private readonly OrderPresenter $presenter,
        private readonly OrderDeliveryRuns $runs,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(AmendOrderDeskOrderRequest $request, string $order): JsonResponse
    {
        $payload = $request->payload();
        $ifMatch = $this->requiredLockVersion($request);

        $record = $this->locator->sellerOrder($order);

        $account = $record->customer_account_id === null
            ? null
            : CustomerAccount::query()->whereKey($record->customer_account_id)->first();
        $address = $this->deskAddress($account, $payload['customer_address_id']);

        $paymentMethod = $payload['payment_method'] === null ? null : PaymentMethod::from($payload['payment_method']);

        if ($paymentMethod !== null && ! $record->fulfilment_type->acceptsPaymentMethod($paymentMethod)) {
            $message = 'That payment method does not suit how this order leaves the kitchen.';

            throw new ApiException(ErrorCode::ValidationFailed, $message, ['fields' => ['payment_method' => [$message]]]);
        }

        $requestedDate = $payload['requested_delivery_date'];

        $amended = $this->placement->amend(
            $record,
            new OrderAmendment(
                lines: $this->basket->aggregate($payload['lines']),
                address: $address,
                requestedDate: $requestedDate === null
                    ? null
                    : CarbonImmutable::createFromFormat('Y-m-d', $requestedDate)->startOfDay(),
                windowCode: $payload['delivery_window_code'],
                paymentMethod: $paymentMethod,
            ),
            $ifMatch,
        );

        $lines = $amended->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->kitchen($amended, $lines, $this->runs->forOrder((string) $amended->getKey()))])
            ->withHeaders(['ETag' => '"'.$amended->lock_version.'"']);
    }
}
