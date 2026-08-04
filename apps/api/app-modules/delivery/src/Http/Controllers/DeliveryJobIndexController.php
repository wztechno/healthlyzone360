<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

final class DeliveryJobIndexController
{
    public function __invoke(): JsonResponse
    {
        $jobs = DeliveryJob::query()->orderByDesc('created_at')->limit(50)->get()->map(fn (DeliveryJob $j): array => [
            'id' => (string) $j->getKey(),
            'order_id' => $j->order_id,
            'status' => $j->status,
            'tracking_status' => $j->tracking_status,
            'driver_user_id' => $j->driver_user_id,
        ]);

        return ApiResponse::data(['delivery_jobs' => $jobs]);
    }
}
