<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Delivery\Services\DeliveryWindowService;
use Healthy360\Delivery\Services\DeliveryZoneLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/delivery-windows/{window}/archive.
 *
 * Terminal, and still not a delete: the window leaves the kitchen's list and
 * every zone that offered it, and stays readable to the orders and
 * subscriptions that already name it. Switching a window off
 * (`is_active: false` on the PATCH) remains the reversible way to stop
 * offering it.
 *
 * **Precondition-free**, as the window PATCH is: a window carries no
 * `lock_version`. Archiving one twice is a `409`, not a silent success.
 */
final class DeliveryWindowArchiveController
{
    public function __construct(
        private readonly DeliveryZoneLocator $locator,
        private readonly DeliveryWindowService $windows,
        private readonly DeliveryAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $window): JsonResponse
    {
        $archived = $this->windows->archive($this->locator->window($window));

        // Every zone has let it go, so it names none.
        return ApiResponse::data(['delivery_window' => $this->presenter->window($archived, [])]);
    }
}
