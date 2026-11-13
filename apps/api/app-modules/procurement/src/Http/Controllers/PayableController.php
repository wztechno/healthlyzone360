<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Services\Payables;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /catalogue/procurement/payables, and the three acts on a row.
 *
 * Reading takes `inventory.view_costs_organisation`, because the rows are money.
 * Approving a price, marking a delivery paid and moving its due date take
 * `inventory.approve_payables_organisation`.
 */
final class PayableController
{
    public function __construct(
        private readonly Payables $payables,
        private readonly TenantContext $context,
    ) {}

    public function index(): JsonResponse
    {
        return ApiResponse::data($this->payables->list((string) $this->context->organisationId()));
    }

    /**
     * @throws ApiException
     */
    public function approvePrice(Request $request, string $goodsReceipt): JsonResponse
    {
        $this->payables->approvePrice($this->receipt($goodsReceipt), (string) $request->user()?->getKey());

        return $this->index();
    }

    /**
     * @throws ApiException
     */
    public function pay(Request $request, string $goodsReceipt): JsonResponse
    {
        /** @var array{reference?: string|null} $validated */
        $validated = $request->validate(['reference' => ['nullable', 'string', 'max:120']]);

        $this->payables->markPaid($this->receipt($goodsReceipt), $validated['reference'] ?? null, (string) $request->user()?->getKey());

        return $this->index();
    }

    /**
     * @throws ApiException
     */
    public function setDueDate(Request $request, string $goodsReceipt): JsonResponse
    {
        /** @var array{due_on?: string|null} $validated */
        $validated = $request->validate(['due_on' => ['present', 'nullable', 'date_format:Y-m-d']]);

        $this->payables->setDueDate($this->receipt($goodsReceipt), $validated['due_on'] ?? null, (string) $request->user()?->getKey());

        return $this->index();
    }

    /**
     * @throws ApiException
     */
    private function receipt(string $id): GoodsReceipt
    {
        $receipt = GoodsReceipt::query()->whereKey($id)->first();

        if (! $receipt instanceof GoodsReceipt) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $receipt;
    }
}
