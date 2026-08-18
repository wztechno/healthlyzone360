<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Presenters\GoodsReceiptPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * GET /catalogue/procurement/unpriced-receipts — the work queue (§3.6).
 *
 * Every receipt whose costing is not finished: the delivery landed, the stock
 * rose, and the invoice has not been entered — or was entered and could not be
 * valued. The list exists because §3.6 refuses the alternative, which is quietly
 * omitting those receipts from a financial total that then looks complete.
 *
 * **Two counts, because they are two different jobs.** `unpriced_line_count` is
 * "type these prices in". `valuation_pending_count` is "the prices are already
 * here and an exchange-rate decision is not this screen's to make" — a row a
 * person cannot action, and one they need to be able to tell apart at a glance
 * rather than by opening it.
 *
 * Behind `inventory.view_costs_organisation` (§5): this is the queue for the
 * person who completes prices, and completing prices is the cost holder's job
 * even though *entering* them at the door is not. There is no money in the rows
 * themselves — the amounts live on the receipt detail, behind the same gate.
 *
 * Ordered oldest first, which is the opposite of every other list in this module
 * and is the point: a work queue is worked from the top, and the oldest
 * outstanding invoice is the one that has been outstanding longest. Cursor
 * paginated over the platform's `(created_at, id)` keyset, oldest first, so that
 * completing rows while somebody walks the list does not shuffle it.
 *
 * The partial index `WHERE cost_status <> 'complete'` is exactly this query.
 */
final class UnpricedReceiptIndexController
{
    public function __construct(private readonly GoodsReceiptPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $organisationId = $context->organisationId();

        $validated = $request->validate([
            'branch_id' => [
                'nullable',
                'uuid',
                Rule::exists('organisation_branches', 'id')->where('organisation_id', $organisationId),
            ],
            'supplier_id' => [
                'nullable',
                'uuid',
                Rule::exists('suppliers', 'id')->where('organisation_id', $organisationId),
            ],
        ]);

        $query = GoodsReceipt::query()
            ->with(['lines', 'supplier'])
            ->where('cost_status', '<>', 'complete');

        if (isset($validated['branch_id'])) {
            $query->where('branch_id', $validated['branch_id']);
        }

        if (isset($validated['supplier_id'])) {
            $query->where('supplier_id', $validated['supplier_id']);
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: false);

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            [
                'unpriced_receipts' => $page['items']
                    ->map(fn (GoodsReceipt $receipt): array => $this->presenter->queueRow($receipt))
                    ->all(),
            ],
            $page['meta'],
        );
    }
}
