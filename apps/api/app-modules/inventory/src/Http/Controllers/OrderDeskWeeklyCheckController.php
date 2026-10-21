<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Http\Concerns\ResolvesForecastScope;
use Healthy360\Inventory\Models\StockSufficiencyCheck;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/order-desk/requirements/weekly-check — the latest
 * weekly stock check for one branch: when it ran, the window it looked at, and
 * the items it found short, as they stood then.
 *
 * `check: null` when the branch has never been checked (or none is named), so
 * the screen draws nothing rather than an all-clear nobody earned. Requires
 * `inventory.view_organisation`, the same code as the buy list it summarises.
 */
final class OrderDeskWeeklyCheckController
{
    use ResolvesForecastScope;

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => ['nullable', 'uuid'],
        ]);

        $branchId = isset($validated['branch_id']) ? (string) $validated['branch_id'] : null;

        if ($branchId === null) {
            return ApiResponse::data(['check' => null]);
        }

        $check = StockSufficiencyCheck::withoutTenancy()
            ->where('organisation_id', $this->forecastOrganisationId($context))
            ->where('branch_id', $branchId)
            ->latest('checked_at')
            ->first();

        return ApiResponse::data([
            'check' => $check === null ? null : [
                'id' => (string) $check->getKey(),
                'branch_id' => $check->branch_id,
                'window_from' => $check->window_from->toDateString(),
                'window_to' => $check->window_to->toDateString(),
                'checked_at' => $check->checked_at->toIso8601String(),
                'requirement_count' => $check->requirement_count,
                'short_count' => $check->short_count,
                'not_computable_days' => $check->not_computable_days,
                'shortfalls' => $check->shortfalls,
            ],
        ]);
    }
}
