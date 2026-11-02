<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Enums\DeliveryFailureReason;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Contracts\DeliveredOrderHandover;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Enum;

/**
 * POST /api/v1/driver/jobs/{job}/fail — I could not hand this over.
 *
 * Only the driver whose run it is, and only once it is on the road: a run nobody
 * collected has not failed, it has not started. It leaves the driver's sheet, the
 * order stays `confirmed`, no money moves, and the managers are alerted. What
 * happens next is theirs to decide (`FailedDelivery`).
 */
final class DriverJobFailController
{
    public function __construct(private readonly DeliveredOrderHandover $handover) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $job): JsonResponse
    {
        $record = DeliveryJob::query()->whereKey($job)->where('driver_user_id', auth()->id())->first();

        if (! $record instanceof DeliveryJob) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        /** @var array{reason: string, note?: string|null} $validated */
        $validated = $request->validate([
            'reason' => ['required', new Enum(DeliveryFailureReason::class)],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $this->handover->failed($record->order_id, DeliveryFailureReason::from($validated['reason']), $validated['note'] ?? null);

        $record->refresh();

        return ApiResponse::data(['job' => ['id' => (string) $record->getKey(), 'status' => $record->status]]);
    }
}
