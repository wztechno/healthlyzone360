<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderComplaint;
use Healthy360\Orders\Services\OrderComplaints;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The kitchen's complaints, each tied to an order. All of it takes
 * `order.supervise_organisation`: a complaint is a manager's.
 */
final class OrderComplaintController
{
    /** The most recent, which is what a list on a kitchen's wall is for. */
    private const int RECENT = 200;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderComplaints $complaints,
    ) {}

    public function index(): JsonResponse
    {
        $rows = OrderComplaint::query()
            ->with(['order:id,order_number', 'remakeOrder:id,order_number'])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(self::RECENT)
            ->get();

        return ApiResponse::data(['complaints' => $rows->map($this->present(...))->values()]);
    }

    /**
     * @throws ApiException
     */
    public function store(Request $request, string $order): JsonResponse
    {
        $target = $this->locator->sellerOrder($order);

        /** @var array{cause: string, description?: string|null, cost_minor?: int|null} $validated */
        $validated = $request->validate([
            'cause' => ['required', Rule::in(OrderComplaint::CAUSES)],
            'description' => ['nullable', 'string', 'max:500'],
            'cost_minor' => ['nullable', 'integer', 'min:0'],
        ]);

        return ApiResponse::data(
            ['complaint' => $this->present($this->complaints->record($target, $validated, (string) auth()->id()))],
            status: 201,
        );
    }

    /**
     * @throws ApiException
     */
    public function update(Request $request, string $complaint): JsonResponse
    {
        $record = $this->resolve($complaint);

        /** @var array{cause?: string, description?: string|null, cost_minor?: int, outcome?: string|null, order_refund_id?: string|null} $validated */
        $validated = $request->validate([
            'cause' => ['sometimes', Rule::in(OrderComplaint::CAUSES)],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'cost_minor' => ['sometimes', 'integer', 'min:0'],
            'outcome' => ['sometimes', 'nullable', Rule::in(array_diff(OrderComplaint::OUTCOMES, ['remade']))],
            'order_refund_id' => ['sometimes', 'nullable', 'uuid'],
        ]);

        return ApiResponse::data(['complaint' => $this->present($this->complaints->update($record, $validated, (string) auth()->id()))]);
    }

    /**
     * @throws ApiException
     */
    public function remake(string $complaint): JsonResponse
    {
        return ApiResponse::data(['complaint' => $this->present($this->complaints->remake($this->resolve($complaint), (string) auth()->id()))]);
    }

    /**
     * @throws ApiException
     */
    private function resolve(string $id): OrderComplaint
    {
        $record = OrderComplaint::query()->whereKey($id)->first();

        if (! $record instanceof OrderComplaint) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $record;
    }

    /**
     * @return array<string, mixed>
     */
    private function present(OrderComplaint $complaint): array
    {
        $order = $complaint->order;
        $remake = $complaint->remakeOrder;

        return [
            'id' => (string) $complaint->getKey(),
            'order_id' => $complaint->order_id,
            'order_number' => $order instanceof Order ? $order->order_number : null,
            'cause' => $complaint->cause,
            'description' => $complaint->description,
            'cost_minor' => $complaint->cost_minor,
            'currency_code' => $complaint->currency_code,
            'outcome' => $complaint->outcome,
            'remake_order_id' => $complaint->remake_order_id,
            'remake_order_number' => $remake instanceof Order ? $remake->order_number : null,
            'order_refund_id' => $complaint->order_refund_id,
            'created_at' => $complaint->created_at?->toIso8601String(),
            'closed_at' => $complaint->closed_at?->toIso8601String(),
        ];
    }
}
