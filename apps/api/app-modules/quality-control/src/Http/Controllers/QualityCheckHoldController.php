<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Inventory\Services\StockQuarantine;
use Healthy360\QualityControl\Models\QualityCheck;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Puts a subject on hold, which sets its stock aside ({@see StockQuarantine}) in
 * the same transaction: a hold on the screen is a hold on the shelf, or neither.
 */
final class QualityCheckHoldController
{
    public function __invoke(string $qualityCheck, StockQuarantine $quarantine, AuditRecorder $audit): JsonResponse
    {
        $check = QualityCheck::query()->whereKey($qualityCheck)->first();
        if ($check === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        DB::transaction(function () use ($check, $quarantine, $audit): void {
            $check->status = 'hold';
            $check->save();

            $quarantine->hold((string) $check->organisation_id, $check->subject_type, $check->subject_id);

            $audit->record('quality_check.held', (string) auth()->id(), 'quality_check', (string) $check->getKey(), [
                'subject_type' => $check->subject_type,
                'subject_id' => $check->subject_id,
            ]);
        });

        return ApiResponse::data(['quality_check' => ['id' => (string) $check->getKey(), 'status' => $check->status]]);
    }
}
