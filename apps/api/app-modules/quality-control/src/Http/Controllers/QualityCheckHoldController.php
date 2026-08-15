<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Http\Controllers;

use Healthy360\QualityControl\Models\QualityCheck;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

final class QualityCheckHoldController
{
    public function __invoke(string $qualityCheck): JsonResponse
    {
        $check = QualityCheck::query()->whereKey($qualityCheck)->first();
        if ($check === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $check->status = 'hold';
        $check->save();

        return ApiResponse::data(['quality_check' => ['id' => (string) $check->getKey(), 'status' => $check->status]]);
    }
}
