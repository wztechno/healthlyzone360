<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Presenters\MonthlyCostReportPresenter;
use Healthy360\Procurement\Services\MonthlyCostReportService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /catalogue/reports/monthly-cost — the monthly cost report (INV1.4).
 *
 * Per month and currency: purchasing spend, cost of goods sold, waste value,
 * revenue, and the margin between revenue and COGS, with a meal-versus-product
 * revenue split and a data-quality flag for months whose COGS is understated by
 * unresolved consumption exceptions.
 *
 * Behind `inventory.view_costs_organisation` at the route: this surface exposes
 * costs *and* the margin reconstructable from them, so it takes the same code the
 * purchases ledger does — a person who may count stock but not read its valuation
 * gets a 403 rather than the kitchen's economics.
 *
 * Bounded by an optional inclusive `from`/`to` month range (`YYYY-MM`); the range
 * is small by nature (a kitchen's trading months), so the report answers the whole
 * filtered set at once rather than paginating.
 */
final class MonthlyCostReportController
{
    public function __construct(
        private readonly MonthlyCostReportService $service,
        private readonly MonthlyCostReportPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['nullable', 'string', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/'],
            'to' => ['nullable', 'string', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/'],
        ]);

        $rows = $this->service->forOrganisation(
            $context->organisationId(),
            $validated['from'] ?? null,
            $validated['to'] ?? null,
        );

        return ApiResponse::data([
            'report' => array_map(fn (array $row): array => $this->presenter->row($row), $rows),
        ]);
    }
}
