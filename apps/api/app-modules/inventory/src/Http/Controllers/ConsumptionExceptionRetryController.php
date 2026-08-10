<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Inventory\Presenters\OrderConsumptionExceptionPresenter;
use Healthy360\Inventory\Services\OrderConsumptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * POST /catalogue/inventory/consumption-exceptions/{exception}/retry (INV1.5).
 *
 * Re-runs the consumption an exception blocks. The kitchen fixed what was missing
 * — published the recipe, created the stock item, received stock — and asks the
 * deduction to run again for that order line.
 *
 * The work is done by {@see OrderConsumptionService::retry()}, which reuses the
 * exact deduction path a confirm uses and guards it per (order line, stock item)
 * so an ingredient a confirm already deducted is never deducted twice. When the
 * line now consumes cleanly the exception auto-resolves; when it still cannot, its
 * detail is refreshed and it stays open. Either way the (possibly settled) row is
 * returned so the caller re-renders without a second read.
 *
 * Idempotent: retrying an already-resolved exception is a no-op. Requires
 * `inventory.manage_organisation`; audited.
 */
final class ConsumptionExceptionRetryController
{
    public function __construct(
        private readonly OrderConsumptionService $consumption,
        private readonly OrderConsumptionExceptionPresenter $presenter,
        private readonly AuditRecorder $audit,
    ) {}

    public function __invoke(
        OrderConsumptionException $exception,
        TenantContext $context,
    ): JsonResponse {
        $result = $this->consumption->retry($exception, $context->userId());

        $this->audit->record(
            'inventory.consumption_exception_retried',
            actorUserId: $context->userId(),
            subjectType: 'order_consumption_exception',
            subjectId: (string) $result->getKey(),
            metadata: [
                'order_id' => $result->order_id,
                'reason_code' => $result->reason_code,
                'resolved' => $result->resolved_at !== null,
            ],
        );

        return ApiResponse::data([
            'exception' => $this->presenter->collection(collect([$result]))[0],
        ]);
    }
}
