<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/order-desk/delivery-windows — the slots a desk sale can
 * be booked into.
 *
 * The read `GET /catalogue/delivery-windows` already serves, narrowed to the
 * **active** windows and moved behind `order.create_on_behalf_organisation`.
 * That route needs `delivery_zone.manage_organisation`, which governs the
 * kitchen's map and which a desk agent taking a telephone order has no reason to
 * hold; the agent only needs to know which slots exist to put the order in one.
 *
 * Withdrawn windows are left out rather than served with their flag: the admin
 * list shows them so they can be reactivated, and a desk picker offering one
 * would book an order into a slot the kitchen has stopped running. Same
 * presenter and same envelope as the admin list, so a client reads one shape.
 */
final class OrderDeskDeliveryWindowIndexController
{
    public function __construct(private readonly DeliveryAdminPresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $windows = DeliveryWindow::query()
            ->where('is_active', true)
            ->orderBy('display_order')
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            $windows->map(fn (DeliveryWindow $window): array => $this->presenter->window($window))->all(),
            [
                'count' => $windows->count(),
                'active_count' => $windows->count(),
            ],
        );
    }
}
