<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class DriverJobDeliverController
{
    public function __invoke(Request $request, string $job): JsonResponse
    {
        $record = DeliveryJob::query()->whereKey($job)->where('driver_user_id', auth()->id())->first();
        if ($record === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $validated = $request->validate([
            'proof_of_delivery_notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $record->status = 'delivered';
        $record->tracking_status = 'delivered';
        $record->delivered_at = now();
        $record->proof_of_delivery_notes = $validated['proof_of_delivery_notes'] ?? null;
        $record->save();

        return ApiResponse::data(['job' => ['id' => (string) $record->getKey(), 'status' => $record->status]]);
    }
}
