<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Kitchens\Models\BranchClosure;
use Healthy360\Kitchens\Services\BranchOperatingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * /api/v1/kitchen/branch-closures — the dates a branch is shut on top of its week.
 *
 * The branch comes from `X-Branch-Id`, as the week's does. Closures that have
 * ended drop off the list and stay in the table; nothing reads them.
 */
final class BranchClosureController
{
    public function __construct(
        private readonly BranchOperatingService $operating,
        private readonly TenantContext $context,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @throws ApiException
     */
    public function index(): JsonResponse
    {
        $rows = BranchClosure::query()
            ->where('branch_id', $this->operating->currentBranchId())
            ->where('closed_to', '>=', CarbonImmutable::today()->subDay()->toDateString())
            ->orderBy('closed_from')
            ->get();

        return ApiResponse::data($rows->map(fn (BranchClosure $closure): array => $this->present($closure))->all());
    }

    /**
     * @throws ApiException
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'closed_from' => ['required', 'date_format:Y-m-d'],
            'closed_to' => ['required', 'date_format:Y-m-d', 'after_or_equal:closed_from'],
            'note' => ['nullable', 'string', 'max:160'],
        ]);

        $closure = BranchClosure::query()->create([
            'organisation_id' => $this->context->organisationId(),
            'branch_id' => $this->operating->currentBranchId(),
            'closed_from' => $validated['closed_from'],
            'closed_to' => $validated['closed_to'],
            'note' => $validated['note'] ?? null,
            'created_by' => $this->context->userId(),
        ]);

        $this->audit->record(
            'branch.closure_added',
            actorUserId: $this->context->userId(),
            subjectType: 'branch_closure',
            subjectId: (string) $closure->getKey(),
            metadata: ['branch_id' => $closure->branch_id, 'closed_from' => $validated['closed_from'], 'closed_to' => $validated['closed_to']],
        );

        return ApiResponse::data($this->present($closure), [], 201);
    }

    /**
     * @throws ApiException
     */
    public function destroy(string $closure): Response
    {
        $row = BranchClosure::query()
            ->where('branch_id', $this->operating->currentBranchId())
            ->whereKey($closure)
            ->firstOrFail();

        $row->delete();

        $this->audit->record(
            'branch.closure_removed',
            actorUserId: $this->context->userId(),
            subjectType: 'branch_closure',
            subjectId: (string) $row->getKey(),
            metadata: ['branch_id' => $row->branch_id],
        );

        return response()->noContent();
    }

    /**
     * @return array{id: string, closed_from: string, closed_to: string, note: string|null}
     */
    private function present(BranchClosure $closure): array
    {
        return [
            'id' => (string) $closure->getKey(),
            'closed_from' => $closure->closed_from->toDateString(),
            'closed_to' => $closure->closed_to->toDateString(),
            'note' => $closure->note,
        ];
    }
}
