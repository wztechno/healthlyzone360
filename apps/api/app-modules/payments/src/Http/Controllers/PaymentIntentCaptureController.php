<?php

declare(strict_types=1);

namespace Healthy360\Payments\Http\Controllers;

use Healthy360\Payments\Models\PaymentIntent;
use Healthy360\Payments\Presenters\PaymentPresenter;
use Healthy360\Payments\Services\PaymentService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

final class PaymentIntentCaptureController
{
    public function __construct(
        private readonly PaymentService $payments,
        private readonly PaymentPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $paymentIntent): JsonResponse
    {
        $intent = PaymentIntent::query()->whereKey($paymentIntent)->first();
        if ($intent === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $intent = $this->payments->capture($intent);

        return ApiResponse::data(['payment_intent' => $this->presenter->intent($intent)]);
    }
}
