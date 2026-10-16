<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Contracts\DeliveredOrderHandover;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/driver/jobs/{job}/deliver — the driver handed the food over.
 *
 * Closes the order too, as the driver (BUG-10): the customer sees it delivered
 * at once, and cash on delivery is receipted to the person who took it rather
 * than to whoever later opened the order at the desk.
 */
final class DriverJobDeliverController
{
    public function __construct(private readonly DeliveredOrderHandover $handover) {}

    public function __invoke(Request $request, string $job): JsonResponse
    {
        $record = DeliveryJob::query()->whereKey($job)->where('driver_user_id', auth()->id())->first();
        if ($record === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $validated = $request->validate([
            'proof_of_delivery_notes' => ['nullable', 'string', 'max:1000'],
        ]);

        // One transaction: a job marked delivered over an order left open is
        // exactly the split this fixes.
        DB::transaction(function () use ($record, $validated): void {
            $record->status = 'delivered';
            $record->tracking_status = 'delivered';
            $record->delivered_at = now();
            $record->proof_of_delivery_notes = $validated['proof_of_delivery_notes'] ?? null;
            $record->save();

            $this->handover->delivered($record->order_id);
        });

        return ApiResponse::data(['job' => ['id' => (string) $record->getKey(), 'status' => $record->status]]);
    }
}
