<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Inventory\Presenters\OrderConsumptionExceptionPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /catalogue/inventory/consumption-exceptions/{exception}/resolve (INV1.5).
 *
 * Marks one exception handled — the kitchen has looked at it and accepted the
 * gap, or fixed it elsewhere and is closing the record. Stamps `resolved_at`,
 * who did it, and an optional note.
 *
 * Idempotent: resolving an already-resolved exception changes nothing and returns
 * the row as it stands, rather than overwriting who first settled it. The
 * `{exception}` is resolved against the caller's organisation, so an exception
 * from another organisation is a 404. Requires `inventory.manage_organisation`;
 * audited.
 */
final class ConsumptionExceptionResolveController
{
    use ResolvesConsumptionException;

    public function __construct(
        private readonly OrderConsumptionExceptionPresenter $presenter,
        private readonly AuditRecorder $audit,
    ) {}

    public function __invoke(
        Request $request,
        string $exception,
        TenantContext $context,
    ): JsonResponse {
        $validated = $request->validate([
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $exception = $this->resolveException($exception, $context);

        if ($exception->resolved_at === null) {
            $exception->resolved_at = now();
            $exception->resolved_by = $context->userId();
            $exception->resolution_note = $validated['note'] ?? null;
            $exception->save();

            $this->audit->record(
                'inventory.consumption_exception_resolved',
                actorUserId: $context->userId(),
                subjectType: 'order_consumption_exception',
                subjectId: (string) $exception->getKey(),
                metadata: [
                    'order_id' => $exception->order_id,
                    'reason_code' => $exception->reason_code,
                ],
            );
        }

        return ApiResponse::data([
            'exception' => $this->presenter->collection(collect([$exception]))[0],
        ]);
    }
}
