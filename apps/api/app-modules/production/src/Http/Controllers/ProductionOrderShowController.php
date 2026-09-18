<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Models\ProductionOrderLine;
use Healthy360\Production\Presenters\ProductionOrderPresenter;
use Healthy360\Production\Services\ProductionOrderService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/production/orders/{productionOrder} — one batch (PROD1).
 *
 * ## A draft's plan is live and a confirmed batch's is not
 *
 * A draft has committed to nothing, so it reads its plan fresh: the shelves move
 * under it, and showing yesterday's availability would be showing a number
 * nobody can act on. From confirm onwards the **lines are the answer** — they are
 * what the kitchen agreed to, what the reservations were opened against and what
 * the estimate was computed from — and re-deriving them would make all three
 * disagree on exactly the batches nobody can reconstruct.
 *
 * So the response carries `lines` once they exist and `plan` while they do not,
 * and never both pretending to be the same thing.
 *
 * Requires `production.view_organisation`; money inside the payload additionally
 * requires `production.view_costs_organisation`.
 */
final class ProductionOrderShowController
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

        /** @var list<ProductionOrderLine> $lines */
        $lines = $order->lines()->orderBy('display_order')->get()->all();

        $payload = [
            'production_order' => $this->presenter->summary($order, $withCosts),
            'lines' => $this->presenter->lines($lines, $withCosts),
        ];

        if ($lines === []) {
            $payload['plan'] = $this->presenter->plan($this->orders->plan($order), $withCosts);
        }

        return ApiResponse::data($payload, ['costs_visible' => $withCosts]);
    }
}
