<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Presenters\ProductionOrderPresenter;
use Healthy360\Production\Services\ProductionOrderService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/production/orders/{productionOrder}/plan — what this
 * batch would need, right now (PROD1).
 *
 * Separate from the batch detail because it answers a *live* question against a
 * moving shelf, and a confirmed batch wants both: what it committed to (its
 * lines) and what the shelves say today (this). Asking the detail endpoint to
 * serve both would make one of the two quietly win.
 *
 * A confirmed batch's plan excludes **its own** claim, so it does not appear
 * short of everything it already holds — the one thing that must never happen
 * when somebody re-opens an order to check it.
 *
 * Writes nothing, and the verb says so.
 *
 * Requires `production.view_organisation`; the cost half additionally requires
 * `production.view_costs_organisation`.
 */
final class ProductionOrderPlanController
{
    use ResolvesProductionOrder;

    public function __construct(
        private readonly ProductionOrderPresenter $presenter,
        private readonly ProductionOrderService $orders,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $productionOrder, TenantContext $context): JsonResponse
    {
        $order = $this->resolveOrder($productionOrder, $context);
        $withCosts = $this->withCosts();

        return ApiResponse::data(
            ['plan' => $this->presenter->plan($this->orders->plan($order), $withCosts)],
            ['costs_visible' => $withCosts],
        );
    }
}
