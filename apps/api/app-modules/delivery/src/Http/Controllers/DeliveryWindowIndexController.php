<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Presenters\DeliveryAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/delivery-windows.
 *
 * **Unpaginated, deliberately.** A kitchen has morning, afternoon and evening,
 * and perhaps a weekend slot; the plan vocabularies K1.6 introduced take the
 * same shape for the same reason. A cursor over four rows would be ceremony,
 * and — more to the point — this is the set a checkout picker renders whole,
 * so paging it would push every client into reassembling it.
 *
 * Deactivated windows are served **with** their flag rather than hidden, the
 * rule every vocabulary in this programme follows: there is no delete, so the
 * only way to see a withdrawn slot is to be shown it.
 */
final class DeliveryWindowIndexController
{
    public function __construct(private readonly DeliveryAdminPresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $windows = DeliveryWindow::query()
            ->orderBy('display_order')
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            $windows->map(fn (DeliveryWindow $window): array => $this->presenter->window($window))->all(),
            [
                'count' => $windows->count(),
                'active_count' => $windows->filter(static fn (DeliveryWindow $window): bool => $window->is_active)->count(),
            ],
        );
    }
}
