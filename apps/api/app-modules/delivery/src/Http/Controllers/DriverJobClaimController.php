<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Delivery\Services\DeliveryJobAssignment;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/driver/jobs/{job}/claim — I will take this one.
 *
 * The other half of the unassigned pool `GET /driver/jobs` serves as
 * `available`. A driver takes a run nobody has been given, without a dispatcher
 * in the loop — which is how a small kitchen actually works.
 *
 * **No permission code**, like the rest of the driver surface: there is no
 * driver role by design (see `OrderDeskDriverIndexController`), so any active
 * member who opens `/driver` may claim. The guard is `DeliveryJobAssignment`'s
 * membership check on the caller and the conditional `UPDATE` below.
 *
 * **First one wins, atomically.** `driver_user_id IS NULL AND status =
 * 'pending'` travels inside the `UPDATE`, so two drivers tapping Claim at once
 * produce one assignment and one `409`; no `If-Match` is needed because the
 * guard *is* the state being contended. A job that does not exist, or belongs to
 * another kitchen, is `404` through the model's organisation scope.
 *
 * Audited as `delivery.job_claimed` rather than `delivery.job_assigned`: the
 * trail should say a driver took it rather than that somebody gave it.
 */
final class DriverJobClaimController
{
    public function __construct(private readonly DeliveryJobAssignment $assignment) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $job): JsonResponse
    {
        $record = DeliveryJob::query()->whereKey($job)->first();

        if (! $record instanceof DeliveryJob) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $claimed = $this->assignment->assign(
            $record,
            (string) auth()->id(),
            ['driver_user_id' => null, 'status' => 'pending'],
            'delivery.job_claimed',
        );

        if (! $claimed) {
            throw new ApiException(ErrorCode::ResourceConflict, 'Someone else took this run before you did.');
        }

        return ApiResponse::data(['job' => ['id' => (string) $record->getKey(), 'status' => $record->status]]);
    }
}
