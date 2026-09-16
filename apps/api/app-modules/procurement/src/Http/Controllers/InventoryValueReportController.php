<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Services\InventoryValuationService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /catalogue/reports/inventory-value — what the stock on hand is worth
 * (PROD1).
 *
 * The one figure in the finance requirement that had no home: the monthly report
 * says what a month bought, sold, wasted and made, and nothing anywhere said what
 * is *left*.
 *
 * ## Current, and it says so
 *
 * There is no period close in this system, and this does not invent one. The
 * answer is `Σ quantity_on_hand × moving_average_cost_amount` as those columns
 * stand at the moment of the read. `as_of` is the instant, published rather than
 * implied, so nobody mistakes a live valuation for a closing one — the second
 * would need snapshots nobody takes, and pretending would put a number in a
 * balance sheet that nothing can reconstruct.
 *
 * ## One row per currency, never a total
 *
 * A kitchen holding dollar flour and euro oil has two valuations. This system has
 * no exchange rate anywhere and will not acquire one here.
 *
 * ## Stock nobody can value is counted, not zeroed
 *
 * `unvalued_item_count` is ingredients holding quantity with no moving average —
 * never bought at a recorded price, or a batch that finished `partial`. Valuing
 * them at zero would make the total read low **and** complete, which is the worse
 * of the two ways to be wrong.
 *
 * Behind `inventory.view_costs_organisation`, the code that gates money across
 * this whole domain.
 */
final class InventoryValueReportController
{
    public function __construct(private readonly InventoryValuationService $valuation) {}

    /**
     * @throws ApiException
     */
    public function __invoke(TenantContext $context): JsonResponse
    {
        $organisationId = (string) $context->organisationId();

        $byCurrency = $this->valuation->byCurrency($organisationId);
        $unvalued = $this->valuation->unvaluedItemCount($organisationId);

        return ApiResponse::data(
            ['inventory_value' => $byCurrency],
            [
                'as_of' => now()->toIso8601String(),
                'unvalued_item_count' => $unvalued,
                // Stated rather than derived from the count, so a client renders
                // "incomplete" without re-deciding what incomplete means.
                'is_complete' => $unvalued === 0,
            ],
        );
    }
}
