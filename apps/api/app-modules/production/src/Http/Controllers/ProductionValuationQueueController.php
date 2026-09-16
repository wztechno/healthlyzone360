<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Enums\ProductionOrderStatus;
use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Presenters\ProductionOrderPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/production/valuations-pending — batches that finished
 * without a cost (PROD1).
 *
 * The unpriced-receipts precedent: a work queue over a state the system can
 * compute, rather than a table somebody has to keep in step. A batch is on it
 * while `actual_cost_status` is anything but `complete`, and leaves it when that
 * changes — which is exactly the definition the monthly report's third
 * completeness flag counts, so the badge and the list can never disagree.
 *
 * ## It is a read, and there is deliberately no "complete the valuation" write
 *
 * The obvious next endpoint would re-value a batch once the missing input costs
 * arrive and blend the result into the produced ingredient's moving average. It
 * is not here, because doing it correctly needs something nobody records: how
 * much of that batch is **still on the shelf**. The average blends a quantity at
 * a cost, and the quantity to blend is not what the batch produced — some of it
 * has been sold since, at whatever average did exist. Blending the full produced
 * quantity would overstate the basis; blending nothing and clearing the flag
 * would tell a reader the period is now trustworthy when it is not.
 *
 * So the batch stays flagged, the report keeps saying that period's
 * finished-goods valuation is understated, and the queue says which batches to
 * look at. Registered as an open question rather than guessed (OQ-052).
 *
 * Requires `production.view_costs_organisation` — the queue is entirely about
 * money, so it takes the money code rather than the desk's view code.
 */
final class ProductionValuationQueueController
{
    use ResolvesProductionOrder;

    private const int LIMIT = 100;

    public function __construct(private readonly ProductionOrderPresenter $presenter) {}

    public function __invoke(TenantContext $context): JsonResponse
    {
        $rows = ProductionOrder::query()
            ->withoutGlobalScopes()
            ->with(['productionItem:id,name_en', 'plannedYieldUnit:id,code'])
            ->where('organisation_id', $context->organisationId())
            ->whereIn('status', [
                ProductionOrderStatus::Completed->value,
                ProductionOrderStatus::Abandoned->value,
            ])
            ->where(function ($inner): void {
                $inner->whereNull('actual_cost_status')
                    ->orWhere('actual_cost_status', '!=', ProductionOrder::COST_COMPLETE);
            })
            ->orderByRaw('COALESCE(completed_at, abandoned_at) DESC')
            ->orderByDesc('id')
            ->take(self::LIMIT)
            ->get();

        return ApiResponse::data([
            'production_orders' => $rows
                // Always with costs: the whole point of the queue is the money
                // that is missing, and the route already demands the code.
                ->map(fn (ProductionOrder $order): array => $this->presenter->summary($order, true))
                ->values()
                ->all(),
        ], [
            'limit' => self::LIMIT,
            // Bounded, and it says so. A queue that silently stops at a hundred
            // is one somebody works through and believes they finished.
            'is_truncated' => $rows->count() === self::LIMIT,
        ]);
    }
}
