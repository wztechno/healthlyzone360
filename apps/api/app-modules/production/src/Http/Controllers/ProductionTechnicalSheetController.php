<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Models\ProductionOrderLine;
use Healthy360\Production\Presenters\ProductionOrderPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/production/orders/{productionOrder}/technical-sheet —
 * what this batch stood on (PROD1).
 *
 * ## It reads the snapshot and nothing else
 *
 * The recipe's technical sheet answers "what does this cost today" and moves
 * when a price is published or a formulation is edited. This answers "what did
 * that batch stand on", and must not move at all.
 *
 * A publication id alone does not freeze it: a fallback price, a produced
 * component's chosen version and the version's nutrition are all things that
 * change underneath a publication. So confirm stores each of them on the order
 * and its lines, and this reads them back. Two questions, two answers, and
 * neither pretending to be the other.
 *
 * Available from **confirm onwards**, because before that there is no snapshot —
 * a draft's live plan is what the plan endpoint is for. A draft answers with an
 * empty `lines` array rather than a 404: the batch exists, and saying so is more
 * useful than pretending it does not.
 *
 * Requires `production.view_organisation`; the money on it additionally requires
 * `production.view_costs_organisation`, redacted field by field.
 */
final class ProductionTechnicalSheetController
{
    use ResolvesProductionOrder;

    public function __construct(private readonly ProductionOrderPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $productionOrder, TenantContext $context): JsonResponse
    {
        $order = $this->resolveOrder($productionOrder, $context);
        $withCosts = $this->withCosts();

        /** @var list<ProductionOrderLine> $lines */
        $lines = $order->lines()->orderBy('display_order')->get()->all();

        return ApiResponse::data(
            ['technical_sheet' => $this->presenter->technicalSheet($order, $lines, $withCosts)],
            ['costs_visible' => $withCosts],
        );
    }
}
