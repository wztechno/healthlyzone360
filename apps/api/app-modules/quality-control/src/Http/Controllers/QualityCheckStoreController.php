<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Http\Controllers;

use Healthy360\QualityControl\Models\QualityCheck;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class QualityCheckStoreController
{
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'subject_type' => ['required', 'string', 'max:48'],
            'subject_id' => ['required', 'uuid'],
            'notes' => ['nullable', 'string'],
        ]);

        $check = QualityCheck::query()->create([
            'organisation_id' => $context->organisationId(),
            'subject_type' => $validated['subject_type'],
            'subject_id' => $validated['subject_id'],
            'status' => 'pending',
            'notes' => $validated['notes'] ?? null,
        ]);

        return ApiResponse::data(['quality_check' => ['id' => (string) $check->getKey(), 'status' => $check->status]], status: 201);
    }
}
