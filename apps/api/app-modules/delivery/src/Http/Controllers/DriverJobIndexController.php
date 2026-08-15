<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

final class DriverJobIndexController
{
    public function __invoke(): JsonResponse
    {
        $userId = (string) auth()->id();
        $jobs = DeliveryJob::query()
            ->where('driver_user_id', $userId)
            ->whereNotIn('status', ['delivered', 'cancelled'])
            ->orderBy('created_at')
            ->get()
            ->map(fn (DeliveryJob $j): array => [
                'id' => (string) $j->getKey(),
                'order_id' => $j->order_id,
                'status' => $j->status,
                'tracking_status' => $j->tracking_status,
            ]);

        return ApiResponse::data(['jobs' => $jobs]);
    }
}
