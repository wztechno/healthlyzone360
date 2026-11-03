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
 * Lets held stock back into use, and names who did: this is the decision an
 * inspector asks about, so it is audited. Food that failed is thrown away through
 * the stock screen first; releasing then frees only what is left on the shelf.
 */
final class QualityCheckReleaseController
{
    public function __invoke(string $qualityCheck, StockQuarantine $quarantine, AuditRecorder $audit): JsonResponse
    {
        $check = QualityCheck::query()->whereKey($qualityCheck)->first();
        if ($check === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        DB::transaction(function () use ($check, $quarantine, $audit): void {
            $check->status = 'released';
            $check->save();

            $quarantine->release((string) $check->organisation_id, $check->subject_id);

            $audit->record('quality_check.released', (string) auth()->id(), 'quality_check', (string) $check->getKey(), [
                'subject_type' => $check->subject_type,
                'subject_id' => $check->subject_id,
            ]);
        });

        return ApiResponse::data(['quality_check' => ['id' => (string) $check->getKey(), 'status' => $check->status]]);
    }
}
