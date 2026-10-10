<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Healthy360\Inventory\Contracts\ProductionValuationLedger;
use Healthy360\Production\Enums\ProductionOrderStatus;
use Healthy360\Production\Models\ProductionOrder;

/**
 * The real answer to Inventory's {@see ProductionValuationLedger} question
 * (PROD1).
 *
 * Bound over the null default in `ProductionServiceProvider::boot()`, the house
 * inverted port — which is what lets the monthly cost report in Procurement flag
 * an unvalued batch without Procurement depending on Production and closing a
 * cycle against `Production → Procurement`.
 *
 * Read live, never cached. The set it counts changes when a batch completes and
 * when somebody later supplies the cost that was missing, and a stored count
 * would be wrong from the moment either happened.
 */
final readonly class ProductionValuationLedgerReader implements ProductionValuationLedger
{
    /**
     * @return array<string, int>
     */
    public function unvaluedBatchCountByMonth(string $organisationId, ?string $from = null, ?string $to = null): array
    {
        $month = "to_char(COALESCE(production_orders.completed_at, production_orders.abandoned_at), 'YYYY-MM')";

        $query = ProductionOrder::query()
            ->withoutGlobalScopes()
            ->where('production_orders.organisation_id', $organisationId)
            ->whereIn('production_orders.status', [
                ProductionOrderStatus::Completed->value,
                ProductionOrderStatus::Abandoned->value,
            ])
            // A batch is unvalued when its cost is anything but `complete`, null
            // included: a completion that never reached the valuation at all is
            // exactly as untrustworthy as one that reached it and failed.
            ->where(function ($inner): void {
                $inner->whereNull('production_orders.actual_cost_status')
                    ->orWhere('production_orders.actual_cost_status', '!=', ProductionOrder::COST_COMPLETE);
            })
            ->whereRaw('COALESCE(production_orders.completed_at, production_orders.abandoned_at) IS NOT NULL')
            ->selectRaw($month.' as month')
            ->selectRaw('COUNT(*) as total')
            ->groupByRaw($month);

        if ($from !== null) {
            $query->whereRaw($month.' >= ?', [$from]);
        }

        if ($to !== null) {
            $query->whereRaw($month.' <= ?', [$to]);
        }

        $out = [];

        foreach ($query->get() as $row) {
            $out[(string) $row->getAttribute('month')] = (int) $row->getAttribute('total');
        }

        return $out;
    }
}
