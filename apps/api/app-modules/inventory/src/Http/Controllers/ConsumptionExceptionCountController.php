<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /catalogue/inventory/consumption-exceptions/unresolved-count (INV1.5).
 *
 * How many consumption exceptions are still open right now — the count the hub
 * badge and the review KPI read without pulling the whole list. Unresolved means
 * `resolved_at IS NULL`, the one predicate the list filter and the report's
 * data-quality flag also read.
 *
 * Scoped to the active branch when `X-Branch-Id` is set and to the whole
 * organisation otherwise — the same narrowing as the low-stock count — by
 * restricting to exceptions whose order sits at that branch. Exceptions carry no
 * branch of their own (they are per order/line), so the branch comes from the
 * order they point at.
 *
 * Requires `inventory.view_organisation`.
 */
final class ConsumptionExceptionCountController
{
    public function __invoke(TenantContext $context): JsonResponse
    {
        $branchId = $context->branchId();
        $organisationId = $context->organisationId();

        $count = OrderConsumptionException::query()
            ->unresolved()
            ->when($branchId !== null, fn ($query) => $query->whereIn(
                'order_id',
                fn ($sub) => $sub
                    ->select('id')
                    ->from('orders')
                    ->where('organisation_id', $organisationId)
                    ->where('branch_id', $branchId),
            ))
            ->count();

        return ApiResponse::data(['count' => $count]);
    }
}
