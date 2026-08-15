<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Http\Requests\StoreDeliveryWindowRequest;
use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Delivery\Services\DeliveryWindowService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/delivery-windows.
 *
 * No `If-Match`: these rows carry no `lock_version`, and the concurrency
 * contract applies only to resources that do.
 *
 * A duplicate `code` inside the organisation is a `409`; the same code in
 * another kitchen is not a collision, because a window is one kitchen's word
 * for one of its own slots.
 */
final class DeliveryWindowStoreController
{
    public function __construct(
        private readonly DeliveryWindowService $windows,
        private readonly DeliveryAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreDeliveryWindowRequest $request): JsonResponse
    {
        $window = $this->windows->create($request->payload());

        return ApiResponse::data(['delivery_window' => $this->presenter->window($window)], status: 201);
    }
}
