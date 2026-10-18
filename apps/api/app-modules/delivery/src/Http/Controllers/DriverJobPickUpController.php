<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/driver/jobs/{job}/pick-up — I have the food and I am on my way.
 *
 * The step between claiming a run and delivering it (HA-19). It is what puts
 * the customer's order "Out for delivery": the run moves to `in_transit` and
 * `en_route` and `picked_up_at` is stamped. The order itself stays `confirmed`
 * — only the driver's deliver closes it.
 *
 * **Only once the kitchen has marked the food ready (HA-28).** A run can be
 * assigned days ahead of a scheduled order; picking it up before it is cooked
 * would tell the customer it is on its way. Refused as `409` with a sentence
 * the driver can act on.
 *
 * **Only the driver whose run it is, and only once.** `driver_user_id = me AND
 * status = 'assigned'` travels inside the `UPDATE`, the claim's own shape: a run
 * that is somebody else's or does not exist is `404`, and one already picked up
 * or delivered is `409`. No `If-Match`, for the reason `DeliveryJob` gives for
 * deliver: nobody races a driver for their own job.
 */
final class DriverJobPickUpController
{
    public function __construct(
        private readonly AuditRecorder $audit,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $job): JsonResponse
    {
        $driverId = (string) auth()->id();

        $record = DeliveryJob::query()->whereKey($job)->where('driver_user_id', $driverId)->first();

        if (! $record instanceof DeliveryJob) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        // Closed by the kitchen by hand (HA-29), or delivered already.
        if (in_array($record->status, ['delivered', 'cancelled'], true)) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This run is already closed.');
        }

        $readyAt = DB::table('orders')->where('id', $record->order_id)->value('ready_at');

        if ($readyAt === null) {
            throw new ApiException(ErrorCode::ResourceConflict, 'The kitchen has not marked this order ready yet.');
        }

        $pickedUpAt = CarbonImmutable::now();

        $updated = DeliveryJob::query()
            ->whereKey($record->getKey())
            ->where('driver_user_id', $driverId)
            ->where('status', 'assigned')
            ->update([
                'status' => 'in_transit',
                'tracking_status' => 'en_route',
                'picked_up_at' => $pickedUpAt,
                'updated_at' => $pickedUpAt,
            ]);

        if ($updated === 0) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This run has already been picked up.');
        }

        $record->refresh();

        $this->audit->record(
            'delivery.job_picked_up',
            actorUserId: $this->context->userId(),
            subjectType: 'delivery_job',
            subjectId: (string) $record->getKey(),
            metadata: [
                'order_id' => $record->order_id,
                'status' => $record->status,
            ],
        );

        return ApiResponse::data(['job' => ['id' => (string) $record->getKey(), 'status' => $record->status]]);
    }
}
