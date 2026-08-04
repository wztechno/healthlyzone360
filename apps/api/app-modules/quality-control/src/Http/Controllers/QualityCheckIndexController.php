<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Http\Controllers;

use Healthy360\QualityControl\Models\QualityCheck;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

final class QualityCheckIndexController
{
    public function __invoke(): JsonResponse
    {
        $checks = QualityCheck::query()->orderByDesc('created_at')->limit(50)->get()->map(fn (QualityCheck $c): array => [
            'id' => (string) $c->getKey(),
            'subject_type' => $c->subject_type,
            'subject_id' => $c->subject_id,
            'status' => $c->status,
        ]);

        return ApiResponse::data(['quality_checks' => $checks]);
    }
}
