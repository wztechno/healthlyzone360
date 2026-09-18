<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Enums\ProductionOrderStatus;
use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Presenters\ProductionOrderPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/production/orders — the production desk queue (PROD1).
 *
 * ## Open batches first, and that is the default rather than the only answer
 *
 * A desk is a working surface: what it is for is the batches somebody still has
 * to do something about. So `status` defaults to the four open states and can be
 * narrowed to any one of the six, which is also how the batch register reads
 * completed runs out of the same endpoint rather than needing a second one.
 *
 * Ordered newest-first by creation rather than by status, because a queue sorted
 * by a status vocabulary teaches people the vocabulary's order instead of showing
 * them their work.
 *
 * ## Bounded, and it says so
 *
 * Fifty per page with an explicit `has_more`, the house pagination shape: a list
 * that silently stops is a list somebody plans a week against and gets wrong.
 *
 * Requires `production.view_organisation`. Money is redacted inside the payload
 * by `production.view_costs_organisation` — see {@see ProductionOrderPresenter}.
 */
final class ProductionOrderIndexController
{
    use ResolvesProductionOrder;

    private const int PER_PAGE = 50;

    public function __construct(private readonly ProductionOrderPresenter $presenter) {}

    /**
     * @throws ValidationException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['nullable', 'string', 'in:'.implode(',', ProductionOrderStatus::values())],
            'branch_id' => ['nullable', 'uuid'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $page = (int) ($validated['page'] ?? 1);

        $query = ProductionOrder::query()
            ->withoutGlobalScopes()
            ->with(['productionItem:id,name_en', 'plannedYieldUnit:id,code'])
            ->where('organisation_id', $context->organisationId());

        if (isset($validated['branch_id'])) {
            $query->where('branch_id', (string) $validated['branch_id']);
        }

        if (isset($validated['status'])) {
            $query->where('status', (string) $validated['status']);
        } else {
            $query->whereIn('status', array_map(
                static fn (ProductionOrderStatus $status): string => $status->value,
                array_values(array_filter(
                    ProductionOrderStatus::cases(),
                    static fn (ProductionOrderStatus $status): bool => $status->isOpen(),
                )),
            ));
        }

        $rows = $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->skip(($page - 1) * self::PER_PAGE)
            // One more than the page, so "is there another page" is answered
            // without a second count query over a table the desk hits constantly.
            ->take(self::PER_PAGE + 1)
            ->get();

        $hasMore = $rows->count() > self::PER_PAGE;
        $withCosts = $this->withCosts();

        return ApiResponse::data([
            'production_orders' => $rows
                ->take(self::PER_PAGE)
                ->map(fn (ProductionOrder $order): array => $this->presenter->summary($order, $withCosts))
                ->values()
                ->all(),
        ], [
            'page' => $page,
            'per_page' => self::PER_PAGE,
            'has_more' => $hasMore,
            'costs_visible' => $withCosts,
        ]);
    }
}
