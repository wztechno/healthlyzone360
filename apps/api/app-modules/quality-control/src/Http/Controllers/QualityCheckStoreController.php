<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Http\Controllers;

use Healthy360\QualityControl\Models\QualityCheck;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class QualityCheckStoreController
{
    /**
     * The subjects a check may attach to (O3). A goods receipt or a
     * production order is where a food-safety hold has to bite; nothing
     * else in the kitchen programme is a QC subject yet.
     *
     * @var list<string>
     */
    private const array SUBJECT_TYPES = ['goods_receipt', 'production_order'];

    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'subject_type' => ['required', 'string', Rule::in(self::SUBJECT_TYPES)],
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
