<?php

declare(strict_types=1);

namespace Healthy360\Payments\Http\Controllers;

use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Payments\Http\Requests\StorePaymentIntentRequest;
use Healthy360\Payments\Presenters\PaymentPresenter;
use Healthy360\Payments\Services\PaymentService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

final class PaymentIntentStoreController
{
    public function __construct(
        private readonly OrderLocator $orders,
        private readonly PaymentService $payments,
        private readonly PaymentPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StorePaymentIntentRequest $request): JsonResponse
    {
        $payload = $request->payload();
        $account = $this->orders->shopper();
        $order = $this->orders->customerOrder($account, $payload['order_id']);

        $intent = $this->payments->createIntentForOrder(
            $order->organisation_id,
            (string) $order->getKey(),
            $payload['method_kind'],
            $order->currency_code,
            $order->total_minor,
        );

        return ApiResponse::data(['payment_intent' => $this->presenter->intent($intent)], status: 201);
    }
}
