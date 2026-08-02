<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Http\Requests\UpdateDeliveryWindowRequest;
use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Delivery\Services\DeliveryWindowService;
use Healthy360\Delivery\Services\DeliveryZoneLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/delivery-windows/{window}.
 *
 * **Precondition-free**: a window carries no `lock_version` (appendix D), and
 * `If-Match` applies only to resources that do — the rule the K1.6 vocabulary
 * PATCHes follow.
 *
 * `code` is refused rather than ignored. `is_active: false` is the only
 * withdrawal there is; there is no DELETE, because an order taken for the
 * evening slot has to stay explainable.
 */
final class DeliveryWindowUpdateController
{
    public function __construct(
        private readonly DeliveryZoneLocator $locator,
        private readonly DeliveryWindowService $windows,
        private readonly DeliveryAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateDeliveryWindowRequest $request, string $window): JsonResponse
    {
        $record = $this->locator->window($window);
        $updated = $this->windows->update($record, $request->payload());

        return ApiResponse::data(['delivery_window' => $this->presenter->window($updated)]);
    }
}
