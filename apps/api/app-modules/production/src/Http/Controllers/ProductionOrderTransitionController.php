<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Models\ProductionOrderLine;
use Healthy360\Production\Presenters\ProductionOrderPresenter;
use Healthy360\Production\Services\BatchReport;
use Healthy360\Production\Services\ProductionOrderService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * The five edges a batch moves along (PROD1): confirm, start, complete, abandon,
 * cancel.
 *
 * ## One controller, five routes, and the reason is the shape rather than laziness
 *
 * Each edge resolves the same batch, checks the same `If-Match`, calls one method
 * on {@see ProductionOrderService} and renders the same payload. Five classes
 * would be five copies of that scaffolding around one differing line, and the
 * differing line is on the service where the rules actually live. The routes stay
 * five, which is what a client and an audit trail see.
 *
 * ## `If-Match` is mandatory on every one of them
 *
 * Two people share a production desk and both can see the same batch. Confirming
 * something somebody else has already started, or completing it twice from two
 * screens, is not hypothetical — so every edge carries the version the caller
 * last read, and a stale one is a 409 that says what the current version is.
 *
 * The service is idempotent underneath that as well (a completed batch completes
 * again as a no-op, and a movement that already exists is not re-posted), because
 * a redelivered request is a different failure from a stale screen and both have
 * to be safe.
 *
 * ## Completion and abandonment take the same report
 *
 * What was used was used and whatever came out came out; the difference is how
 * the batch ends and whether a reason is required. Sharing the payload is what
 * makes "abandon" an honest option rather than a lossy one — a kitchen that has
 * to retype everything to abandon will cancel instead and leave the flour
 * unaccounted for.
 *
 * Requires `production.manage_organisation`.
 */
final class ProductionOrderTransitionController
{
    use ResolvesProductionOrder;

    public function __construct(
        private readonly ProductionOrderService $orders,
        private readonly ProductionOrderPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function confirm(Request $request, string $productionOrder, TenantContext $context): JsonResponse
    {
        $order = $this->resolveOrder($productionOrder, $context);
        $this->assertFresh($request, $order);

        return $this->render($this->orders->confirm($order, $context->userId()));
    }

    /**
     * @throws ApiException
     */
    public function start(Request $request, string $productionOrder, TenantContext $context): JsonResponse
    {
        $order = $this->resolveOrder($productionOrder, $context);
        $this->assertFresh($request, $order);

        return $this->render($this->orders->start($order, $context->userId()));
    }

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function complete(Request $request, string $productionOrder, TenantContext $context): JsonResponse
    {
        $order = $this->resolveOrder($productionOrder, $context);
        $this->assertFresh($request, $order);

        return $this->render($this->orders->complete($order, $this->reportFrom($request), $context->userId()));
    }

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function abandon(Request $request, string $productionOrder, TenantContext $context): JsonResponse
    {
        $order = $this->resolveOrder($productionOrder, $context);
        $this->assertFresh($request, $order);

        $reason = $request->validate([
            // Required, unlike every other field here. An abandoned batch is a
            // loss somebody will ask about in a month, and "no reason given" is
            // the answer that makes the record useless.
            'reason' => ['required', 'string', 'max:255'],
        ])['reason'];

        return $this->render($this->orders->abandon($order, $this->reportFrom($request), (string) $reason, $context->userId()));
    }

    /**
     * @throws ApiException
     */
    public function cancel(Request $request, string $productionOrder, TenantContext $context): JsonResponse
    {
        $order = $this->resolveOrder($productionOrder, $context);
        $this->assertFresh($request, $order);

        return $this->render($this->orders->cancel($order, $context->userId()));
    }

    /**
     * What the cook says happened.
     *
     * `consumed` and `waste` arrive keyed by stock item, which is how the plan
     * and the lines are keyed and therefore what a screen already holds.
     * Omitting a line from `consumed` means "as planned" rather than "nothing" —
     * a cook who followed the recipe should not have to retype it — while
     * omitting one from `waste` means none, because waste nobody mentioned did
     * not happen.
     *
     * @throws ValidationException
     */
    private function reportFrom(Request $request): BatchReport
    {
        $validated = $request->validate([
            'produced_quantity' => ['required', 'numeric', 'min:0'],
            'rejected_quantity' => ['nullable', 'numeric', 'min:0'],
            'consumed' => ['nullable', 'array'],
            'consumed.*' => ['numeric', 'min:0'],
            'waste' => ['nullable', 'array'],
            'waste.*' => ['numeric', 'min:0'],
            'production_date' => ['nullable', 'date_format:Y-m-d'],
            'storage_location' => ['nullable', 'string', 'max:120'],
            'expiry_date' => ['nullable', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        try {
            return new BatchReport(
                producedQuantity: (string) $validated['produced_quantity'],
                rejectedQuantity: (string) ($validated['rejected_quantity'] ?? '0'),
                consumed: $this->quantityMap($validated['consumed'] ?? []),
                waste: $this->quantityMap($validated['waste'] ?? []),
                productionDate: $validated['production_date'] ?? null,
                storageLocation: $validated['storage_location'] ?? null,
                expiryDate: $validated['expiry_date'] ?? null,
                notes: $validated['notes'] ?? null,
            );
        } catch (InvalidArgumentException $exception) {
            // The DTO narrows its own quantities, and the validator above should
            // have caught anything it rejects. Translated rather than allowed to
            // escape as a 500, so a shape the validator someday stops covering
            // still reaches the client as a field error.
            throw ValidationException::withMessages(['produced_quantity' => $exception->getMessage()]);
        }
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @return array<string, string>
     */
    private function quantityMap(array $values): array
    {
        $map = [];

        foreach ($values as $stockItemId => $quantity) {
            if (is_scalar($quantity)) {
                $map[(string) $stockItemId] = (string) $quantity;
            }
        }

        return $map;
    }

    private function render(ProductionOrder $order): JsonResponse
    {
        $withCosts = $this->withCosts();
        $order->loadMissing(ProductionOrderPresenter::RELATIONS);

        /** @var list<ProductionOrderLine> $lines */
        $lines = $order->lines()->orderBy('display_order')->get()->all();

        return ApiResponse::data([
            'production_order' => $this->presenter->summary($order, $withCosts),
            'lines' => $this->presenter->lines($lines, $withCosts),
        ], ['costs_visible' => $withCosts]);
    }
}
